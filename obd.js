// Car Scan: ELM327 OBD-II reader for the browser (Web Bluetooth) + plain-text report for any AI.
// READ-ONLY: nothing here clears codes or changes anything on the car.

// --------------------------------------------------------------------------- Bluetooth transport
// Common BLE "serial" services used by ELM327 adapters (Veepeak, Vgate, vLinker, OBDLink, HM-10 clones).
const BLE_SERVICES = [
  0xfff0, 0xffe0, 0x18f0, 0xffb0, 0xfee7,
  "e7810a71-73ae-499d-8c15-faa9aef0c3f2",
  "0000fff0-0000-1000-8000-00805f9b34fb",
];

export class BleTransport {
  constructor() { this.buf = ""; this.waiter = null; }

  async open() {
    if (!navigator.bluetooth) {
      throw new Error("This browser can't use Bluetooth. On iPhone, open this page in the free Bluefy app. On Android, use Chrome.");
    }
    this.device = await navigator.bluetooth.requestDevice({ acceptAllDevices: true, optionalServices: BLE_SERVICES });
    const server = await this.device.gatt.connect();
    let write = null, notify = null;
    for (const svc of await server.getPrimaryServices()) {
      let w = null, n = null;
      for (const ch of await svc.getCharacteristics()) {
        const p = ch.properties;
        if (!n && (p.notify || p.indicate)) n = ch;
        if (!w && (p.write || p.writeWithoutResponse)) w = ch;
      }
      if (w && n && (!write || svc.uuid.includes("fff0"))) { write = w; notify = n; }
    }
    if (!write) throw new Error("Connected, but this doesn't look like an OBD adapter (no serial channel found). Pick the adapter's name in the list.");
    this.write = write;
    this.withResponse = !!write.properties.write;
    await notify.startNotifications();
    notify.addEventListener("characteristicvaluechanged", (e) => {
      this.buf += new TextDecoder().decode(e.target.value);
      if (this.buf.includes(">") && this.waiter) { const w = this.waiter; this.waiter = null; w(); }
    });
    this.name = this.device.name || "Bluetooth adapter";
  }

  async send(cmd, timeout = 5000) {
    this.buf = "";
    const data = new TextEncoder().encode(cmd + "\r");
    const done = new Promise((res) => { this.waiter = res; setTimeout(res, timeout); });
    if (this.withResponse) await this.write.writeValueWithResponse(data);
    else await this.write.writeValueWithoutResponse(data);
    await done;
    this.waiter = null;
    return this.buf;
  }

  async close() { try { this.device?.gatt?.disconnect(); } catch {} }
}

// --------------------------------------------------------------------------- decoding
const u16 = (d) => d[0] * 256 + d[1];
const trim = (d) => ((d[0] - 128) * 100) / 128;

export const PIDS = {
  0x04: ["engine_load", "%", (d) => (d[0] * 100) / 255],
  0x05: ["coolant_temp", "C", (d) => d[0] - 40],
  0x06: ["short_fuel_trim_bank1", "%", trim],
  0x07: ["long_fuel_trim_bank1", "%", trim],
  0x08: ["short_fuel_trim_bank2", "%", trim],
  0x09: ["long_fuel_trim_bank2", "%", trim],
  0x0b: ["intake_manifold_pressure", "kPa", (d) => d[0]],
  0x0c: ["rpm", "rpm", (d) => u16(d) / 4],
  0x0d: ["speed", "km/h", (d) => d[0]],
  0x0e: ["timing_advance", "deg", (d) => d[0] / 2 - 64],
  0x0f: ["intake_air_temp", "C", (d) => d[0] - 40],
  0x10: ["maf_airflow", "g/s", (d) => u16(d) / 100],
  0x11: ["throttle_position", "%", (d) => (d[0] * 100) / 255],
  0x14: ["o2_bank1_sensor1_voltage", "V", (d) => d[0] / 200],
  0x15: ["o2_bank1_sensor2_voltage", "V", (d) => d[0] / 200],
  0x18: ["o2_bank2_sensor1_voltage", "V", (d) => d[0] / 200],
  0x19: ["o2_bank2_sensor2_voltage", "V", (d) => d[0] / 200],
  0x1f: ["run_time_since_start", "s", u16],
  0x21: ["distance_with_mil_on", "km", u16],
  0x24: ["o2_sensor1_wideband_lambda", "lambda", (d) => (u16(d) * 2) / 65536],
  0x2f: ["fuel_level", "%", (d) => (d[0] * 100) / 255],
  0x30: ["warmups_since_codes_cleared", "count", (d) => d[0]],
  0x31: ["distance_since_codes_cleared", "km", u16],
  0x33: ["barometric_pressure", "kPa", (d) => d[0]],
  0x34: ["o2_sensor1_wideband_lambda_current", "lambda", (d) => (u16(d) * 2) / 65536],
  0x42: ["control_module_voltage", "V", (d) => u16(d) / 1000],
  0x44: ["commanded_lambda", "lambda", (d) => (u16(d) * 2) / 65536],
  0x46: ["ambient_air_temp", "C", (d) => d[0] - 40],
  0x4d: ["time_with_mil_on", "min", u16],
  0x4e: ["time_since_codes_cleared", "min", u16],
  0x5c: ["engine_oil_temp", "C", (d) => d[0] - 40],
};

function formatValue(unit, value) {
  const out = { value: Math.round(value * 1000) / 1000, unit };
  if (unit === "C") out.imperial = `${Math.round((value * 9) / 5 + 32)} F`;
  else if (unit === "km/h") out.imperial = `${Math.round(value * 0.621371)} mph`;
  else if (unit === "km") out.imperial = `${Math.round(value * 0.621371)} mi`;
  else if (unit === "kPa") out.imperial = `${Math.round(value * 1.45038) / 10} psi`;
  return out;
}

const hex2 = (n) => n.toString(16).toUpperCase().padStart(2, "0");
const decodeDtc = (b1, b2) => `${"PCBU"[b1 >> 6]}${(b1 >> 4) & 3}${(b1 & 0xf).toString(16).toUpperCase()}${hex2(b2)}`;
const fromHex = (h) => Uint8Array.from(h.match(/../g) || [], (x) => parseInt(x, 16));

const SPARK_MONITORS = ["catalyst", "heated_catalyst", "evap_system", "secondary_air",
  "ac_refrigerant", "oxygen_sensor", "oxygen_sensor_heater", "egr_system"];
const DIESEL_MONITORS = ["nmhc_catalyst", "nox_scr", null, "boost_pressure",
  null, "exhaust_gas_sensor", "particulate_filter", "egr_vvt"];
const ERROR_REPLIES = ["NO DATA", "UNABLE TO CONNECT", "CAN ERROR", "BUS ERROR", "STOPPED", "?"];

// --------------------------------------------------------------------------- adapter
export class ELM327 {
  constructor(t) { this.t = t; this.adapter = "unknown"; this.protocol = "unknown"; this.isCan = true; this.supported = new Set(); }

  async cmd(cmd, timeout = 5000) {
    const raw = await this.t.send(cmd, timeout);
    return raw.replace(/\r/g, "\n").split("\n")
      .map((l) => l.replace(/>/g, "").trim().toUpperCase())
      .filter((l) => l && l !== cmd.toUpperCase() && !l.startsWith("SEARCHING") && !l.startsWith("BUS INIT"));
  }

  async initialize() {
    await this.t.open();
    await this.cmd("ATZ", 3000);
    await new Promise((r) => setTimeout(r, 500));
    for (const c of ["ATE0", "ATL0", "ATS0", "ATH0", "ATSP0"]) await this.cmd(c);
    this.adapter = (await this.cmd("ATI")).join(" ") || "unknown";
    const reply = await this.cmd("0100", 15000);
    if (!reply.some((l) => l.replace(/ /g, "").startsWith("4100"))) {
      throw new Error("The adapter is connected but the car didn't answer. Turn the ignition ON (engine can be off) and try again. "
        + `Adapter said: ${reply.join(" ") || "nothing"}`);
    }
    let dp = (await this.cmd("ATDPN")).join("");
    if (dp.length === 2 && dp.startsWith("A")) dp = dp[1];
    this.protocol = dp;
    this.isCan = "6789ABC".includes(dp) && dp.length === 1;
    await this.loadSupported();
  }

  static payloads(lines) {
    // Several computers can answer one request. Single-frame replies arrive one per line; multi-frame (CAN)
    // replies arrive as an optional length line ("014") followed by "0:", "1:", ... Each "0:" starts a new message.
    lines = lines.map((l) => l.replace(/ /g, ""));
    const out = [];
    let frames = null, len = null;
    const flush = () => {
      if (frames) { const blob = fromHex(frames.join("")); out.push(len ? blob.slice(0, len) : blob); }
      frames = null; len = null;
    };
    for (const l of lines) {
      if (/^[0-9A-F]{3}$/.test(l)) { flush(); len = parseInt(l, 16); continue; }
      const m = l.match(/^([0-9A-F]):([0-9A-F]*)$/);
      if (m) {
        if (m[1] === "0" && frames?.length) flush();
        (frames ||= []).push(m[2]);
        continue;
      }
      flush();
      if (/^(?:[0-9A-F]{2})+$/.test(l)) out.push(fromHex(l));
    }
    flush();
    return out;
  }

  async pidAll(pid) {
    const out = [];
    for (const p of ELM327.payloads(await this.cmd(`01${hex2(pid)}`))) {
      if (p.length >= 2 && p[0] === 0x41 && p[1] === pid) out.push(p.slice(2));
    }
    return out;
  }

  async pid(pid) {
    for (const p of ELM327.payloads(await this.cmd(`01${hex2(pid)}`))) {
      if (p.length >= 2 && p[0] === 0x41 && p[1] === pid) return p.slice(2);
    }
    return null;
  }

  async readPid(pid) {
    const d = await this.pid(pid);
    if (!d || !PIDS[pid]) return null;
    const [name, unit, fn] = PIDS[pid];
    const v = fn(d);
    return Number.isFinite(v) ? { name, ...formatValue(unit, v) } : null;
  }

  async loadSupported() {
    this.supported = new Set();
    for (let base = 0; base <= 0xa0; base += 0x20) {
      const replies = (await this.pidAll(base)).filter((d) => d.length >= 4);
      if (!replies.length) break;
      for (const d of replies) {
        const bits = ((d[0] << 24) | (d[1] << 16) | (d[2] << 8) | d[3]) >>> 0;
        for (let i = 0; i < 32; i++) if (bits & (2 ** (31 - i))) this.supported.add(base + i + 1);
      }
      if (!this.supported.has(base + 0x20)) break;
    }
  }

  async dtcs(mode) {
    const sid = parseInt(mode, 16) + 0x40;
    const codes = new Set();
    for (const p of ELM327.payloads(await this.cmd(mode))) {
      if (!p.length || p[0] !== sid) continue;
      let body = p.slice(1);
      if (this.isCan && body.length) body = body.slice(1);
      for (let i = 0; i + 1 < body.length; i += 2) if (body[i] || body[i + 1]) codes.add(decodeDtc(body[i], body[i + 1]));
    }
    return [...codes].sort();
  }

  async vin() {
    let chars = "";
    for (const p of ELM327.payloads(await this.cmd("0902", 6000))) {
      if (p.length >= 3 && p[0] === 0x49 && p[1] === 0x02) {
        for (const b of p.slice(3)) if (b >= 0x30 && b <= 0x5a) chars += String.fromCharCode(b);
      }
    }
    return chars.length >= 17 ? chars.slice(-17) : chars || null;
  }

  async batteryVoltage() {
    const r = (await this.cmd("ATRV")).join("");
    return r && !ERROR_REPLIES.includes(r) ? r : null;
  }

  async readiness() {
    let best = null, mil = false;
    for (const d of await this.pidAll(0x01)) {
      if (d.length < 4) continue;
      const [a, b, c, dd] = d;
      mil ||= !!(a & 0x80);
      const diesel = !!(b & 0x08);
      const monitors = {};
      [[0, "misfire"], [1, "fuel_system"], [2, "comprehensive_components"]].forEach(([bit, name]) => {
        if (b & (1 << bit)) monitors[name] = b & (1 << (bit + 4)) ? "NOT READY" : "complete";
      });
      (diesel ? DIESEL_MONITORS : SPARK_MONITORS).forEach((name, bit) => {
        if (name && c & (1 << bit)) monitors[name] = dd & (1 << bit) ? "NOT READY" : "complete";
      });
      if (!best || Object.keys(monitors).length > Object.keys(best.monitors).length) {
        best = { engineType: diesel ? "diesel" : "gasoline", monitors };
      }
    }
    if (!best) return null;
    return { mil, ...best, notReady: Object.keys(best.monitors).filter((k) => best.monitors[k] === "NOT READY") };
  }

  async freezeFrame() {
    let trigger = null;
    for (const p of ELM327.payloads(await this.cmd("020200"))) {
      if (p.length >= 5 && p[0] === 0x42 && p[1] === 0x02 && (p[3] || p[4])) trigger = decodeDtc(p[3], p[4]);
    }
    if (!trigger) return null;
    const values = {};
    for (const pid of [0x04, 0x05, 0x06, 0x07, 0x08, 0x09, 0x0b, 0x0c, 0x0d, 0x0f, 0x10, 0x11]) {
      for (const p of ELM327.payloads(await this.cmd(`02${hex2(pid)}00`))) {
        if (p.length >= 4 && p[0] === 0x42 && p[1] === pid) {
          const [name, unit, fn] = PIDS[pid];
          const v = fn(p.slice(3));
          if (Number.isFinite(v)) values[name] = formatValue(unit, v);
        }
      }
    }
    return { triggeredBy: trigger, values };
  }

  close() { return this.t.close(); }
}

// --------------------------------------------------------------------------- code meanings
const COMMON = {
  P0011: "Camshaft timing over-advanced (bank 1). Often low/dirty oil or a sticking VVT solenoid.",
  P0016: "Crankshaft/camshaft position correlation (bank 1). Timing chain stretch or VVT issue.",
  P0101: "Mass airflow (MAF) sensor range/performance. Dirty MAF or air leak after the sensor.",
  P0102: "MAF sensor circuit low.",
  P0113: "Intake air temperature sensor circuit high.",
  P0117: "Coolant temperature sensor circuit low.",
  P0118: "Coolant temperature sensor circuit high.",
  P0125: "Engine takes too long to reach closed-loop temperature. Often a stuck-open thermostat.",
  P0128: "Coolant below thermostat regulating temperature. Usually a stuck-open thermostat.",
  P0130: "O2 sensor circuit (bank 1, sensor 1).",
  P0133: "O2 sensor slow response (bank 1, sensor 1). Aging upstream O2 sensor.",
  P0135: "O2 sensor heater circuit (bank 1, sensor 1).",
  P0141: "O2 sensor heater circuit (bank 1, sensor 2).",
  P0171: "System too lean (bank 1). Vacuum leak, dirty MAF, weak fuel pump or clogged filter.",
  P0172: "System too rich (bank 1). Leaking injector, high fuel pressure, bad MAF or coolant sensor.",
  P0174: "System too lean (bank 2). With P0171, points to something shared: vacuum leak, MAF, fuel pressure.",
  P0175: "System too rich (bank 2).",
  P0300: "Random/multiple cylinder misfire. Plugs, coils, vacuum leak, low fuel pressure.",
  P0301: "Cylinder 1 misfire.", P0302: "Cylinder 2 misfire.", P0303: "Cylinder 3 misfire.",
  P0304: "Cylinder 4 misfire.", P0305: "Cylinder 5 misfire.", P0306: "Cylinder 6 misfire.",
  P0325: "Knock sensor circuit (bank 1).",
  P0335: "Crankshaft position sensor circuit.",
  P0340: "Camshaft position sensor circuit.",
  P0401: "EGR flow insufficient. Clogged EGR passages or bad EGR valve.",
  P0402: "EGR flow excessive.",
  P0411: "Secondary air injection flow incorrect.",
  P0420: "Catalytic converter efficiency below threshold (bank 1). Bad cat, or a lazy/failed downstream O2 sensor or exhaust leak.",
  P0430: "Catalytic converter efficiency below threshold (bank 2).",
  P0440: "Evaporative emission (EVAP) system malfunction.",
  P0441: "EVAP purge flow incorrect. Often the purge valve.",
  P0442: "EVAP small leak detected. Gas cap seal, purge/vent valve, or cracked hose.",
  P0446: "EVAP vent control circuit. Often the vent valve/solenoid.",
  P0455: "EVAP large leak detected. Loose or missing gas cap is the classic cause.",
  P0456: "EVAP very small leak detected. Often the gas cap.",
  P0496: "EVAP high purge flow. Purge valve stuck open.",
  P0500: "Vehicle speed sensor.",
  P0505: "Idle air control system.",
  P0507: "Idle speed higher than expected. Vacuum leak or dirty throttle body.",
  P0562: "System voltage low. Weak battery or charging problem.",
  P0700: "Transmission control system fault. Read the transmission module for the real code.",
  P0715: "Transmission input/turbine speed sensor.",
  P0741: "Torque converter clutch stuck off.",
  P2096: "Post-catalyst fuel trim too lean (bank 1). Often an exhaust leak.",
  P2097: "Post-catalyst fuel trim too rich (bank 1).",
  P2195: "O2 sensor signal stuck lean (bank 1, sensor 1).",
  P2196: "O2 sensor signal stuck rich (bank 1, sensor 1).",
  U0100: "Lost communication with the engine control module.",
};
const SYSTEMS = { P: "Powertrain", C: "Chassis", B: "Body", U: "Network" };
export function describe(code) {
  const makerSpecific = "13".includes(code[1]);
  return COMMON[code] || `${SYSTEMS[code[0]] || "Unknown"} code` +
    (makerSpecific ? " (manufacturer-specific: meaning depends on the make)" : " (generic: not in the built-in list)");
}

// --------------------------------------------------------------------------- scan
const LIVE_DEFAULT = [0x0c, 0x0d, 0x04, 0x05, 0x5c, 0x0f, 0x46, 0x06, 0x07, 0x08, 0x09, 0x0b, 0x10, 0x11,
  0x0e, 0x14, 0x15, 0x18, 0x19, 0x24, 0x34, 0x44, 0x2f, 0x42, 0x33, 0x1f];
const SAMPLE_DEFAULT = [0x0c, 0x05, 0x06, 0x07, 0x08, 0x09, 0x10, 0x14, 0x15, 0x18, 0x19, 0x24];

export async function scan(transport, { sampleSeconds = 10, onStep = () => {}, keepOpen = false } = {}) {
  const elm = new ELM327(transport);
  const out = {};
  onStep("Connecting to the adapter…");
  await elm.initialize();
  try {
    onStep("Reading car info…");
    out.vehicle = { vin: await elm.vin(), adapter: elm.adapter, protocol: elm.protocol,
      battery: await elm.batteryVoltage(), simulated: !!transport.simulated };
    onStep("Reading trouble codes…");
    out.readiness = await elm.readiness();
    out.codes = { stored: await elm.dtcs("03"), pending: await elm.dtcs("07"), permanent: await elm.dtcs("0A") };
    onStep("Reading freeze frame…");
    out.freeze = await elm.freezeFrame();
    onStep("Reading live data…");
    out.live = {};
    for (const pid of LIVE_DEFAULT.filter((p) => !elm.supported.size || elm.supported.has(p))) {
      const v = await elm.readPid(pid);
      if (v) { out.live[v.name] = v; delete v.name; }
    }
    out.engineRunning = (out.live.rpm?.value || 0) > 300;
    out.sinceCleared = {};
    for (const pid of [0x30, 0x31, 0x4e, 0x21, 0x4d]) {
      if (elm.supported.size && !elm.supported.has(pid)) continue;
      const v = await elm.readPid(pid);
      if (v) { out.sinceCleared[v.name] = v; delete v.name; }
    }
    if (sampleSeconds && out.engineRunning) {
      const pids = SAMPLE_DEFAULT.filter((p) => !elm.supported.size || elm.supported.has(p));
      const series = {}, units = {};
      const end = Date.now() + sampleSeconds * 1000;
      while (Date.now() < end) {
        onStep(`Recording sensors… ${Math.max(0, Math.ceil((end - Date.now()) / 1000))}s`);
        for (const pid of pids) {
          const v = await elm.readPid(pid);
          if (v) { (series[v.name] ||= []).push(v.value); units[v.name] = v.unit; }
        }
        await new Promise((r) => setTimeout(r, 50));
      }
      out.sampled = { seconds: sampleSeconds, sensors: {} };
      for (const [name, vals] of Object.entries(series)) {
        const s = { min: Math.min(...vals), avg: vals.reduce((a, b) => a + b, 0) / vals.length, max: Math.max(...vals), unit: units[name] };
        if (units[name] === "V" && name.includes("o2")) {
          s.switches = vals.slice(1).filter((b, i) => (vals[i] - 0.45) * (b - 0.45) < 0).length;
        }
        out.sampled.sensors[name] = s;
      }
    }
  } catch (e) {
    await elm.close();
    throw e;
  }
  if (keepOpen) Object.defineProperty(out, "elm", { value: elm, enumerable: false });
  else await elm.close();
  return out;
}

// --------------------------------------------------------------------------- report
export const EXTRA_COMMANDS_HELP = `

OPTIONAL, MORE DATA: The app can run extra read-only commands through the same ELM327 adapter, for example manufacturer-specific data such as tire pressures, transmission temperature, or ABS codes for this make/model (use the VIN). Only if it would really help, end your answer with a block exactly like this, one command per line, with a short label after "|":

CARSCAN-COMMANDS
ATSH 7E1 | transmission module
22 1E1C | transmission fluid temp
END

Only read requests are allowed (services 01-0A, 18, 19, 1A, 21, 22 plus ATSH/ATCRA header settings); anything else is blocked by the app. Only send commands you are reasonably confident apply to this vehicle, and say how sure you are.`;

export const QUESTION = `I plugged an OBD-II scanner into my car. The full scan is below. Act as an experienced, honest mechanic explaining it to a car owner who isn't a mechanic. Base everything on the data; when the data can't settle something, say so instead of guessing.

Answer in this order:
1. Bottom line: one or two plain sentences on what is most likely wrong.
2. Is it safe to drive? Yes / with caution / no, and what could happen if I ignore it.
3. Likely causes, ranked: for each, roughly how likely it is and which numbers in the scan point to it (or against it).
4. What to check first: simple checks I can do myself, in order, with the tools needed and a difficulty rating (easy / moderate / leave it to a shop).
5. Costs: rough DIY parts cost and rough shop price for each likely fix (US prices).
6. When to see a mechanic, and exactly what to tell them, including codes and key readings.
7. If a mechanic is needed, how to save money on this specific repair: independent shop vs dealer, whether to skip paying for a diagnostic fee since I already have this scan, whether warranty, a recall, or a service bulletin might cover it (for example the federal 8-year/80,000-mile emissions warranty on catalytic converters), fair price ranges so I can spot an overquote, upsells to politely decline, and whether buying the part myself makes sense.
8. Anything else in the scan that looks off, even if it isn't causing the light.

Keep it short and skimmable. If no codes are set and the readings look normal, say so plainly.${EXTRA_COMMANDS_HELP}`;

export const USED_CAR_QUESTION = `I'm thinking about buying this used car and plugged an OBD-II scanner into it. The full scan is below. Act as an experienced, honest mechanic helping a buyer who isn't a mechanic. Base everything on the data; when the data can't settle something, say so.

Answer in this order:
1. Verdict: buy, negotiate, or walk away, in one or two sentences.
2. Red flags: anything that suggests a hidden problem, especially codes cleared recently (few warm-ups or miles since clearing), emissions monitors NOT READY, pending or permanent codes, or abnormal readings.
3. Likely repair costs for anything found (DIY parts and shop price, US), so I know how much to negotiate.
4. What to ask the seller, and what to check on a test drive or with a mechanic's pre-purchase inspection.
5. What this scan can't tell me (brakes, suspension, rust, transmission health, ABS/airbag).

Keep it short and skimmable.${EXTRA_COMMANDS_HELP}`;

const fmt = (v) => (v.imperial ? `${v.imperial} (${v.value} ${v.unit})` : `${v.value} ${v.unit}`.trim());
const toF = (c) => Math.round((c * 9) / 5 + 32);
const r3 = (n) => Math.round(n * 1000) / 1000;

export function buildReport(d) {
  const L = [];
  const now = new Date();
  L.push(`CAR SCAN REPORT (${now.toLocaleString()})`);
  if (d.vehicle.simulated) L.push("NOTE: test scan of a simulated car (mock mode), not a real vehicle.");
  if (d.vehicle.decoded) L.push(`Vehicle: ${d.vehicle.decoded}`);
  L.push(`VIN: ${d.vehicle.vin || "unknown"} | Battery: ${d.vehicle.battery || "?"} | Adapter: ${d.vehicle.adapter}`);
  if (!d.engineRunning) L.push("NOTE: engine was OFF during this scan, so live data is limited.");

  L.push("", "== TROUBLE CODES ==");
  L.push(`Check engine light: ${d.readiness?.mil ? "ON" : "off"}`);
  for (const kind of ["stored", "pending", "permanent"]) {
    const items = d.codes[kind];
    const label = kind[0].toUpperCase() + kind.slice(1);
    if (!items.length) L.push(`${label}: none`);
    for (const c of items) L.push(`${label}: ${c} - ${describe(c)}`);
  }

  L.push("", "== FREEZE FRAME (conditions when the light came on) ==");
  if (d.freeze) {
    L.push(`Triggered by: ${d.freeze.triggeredBy}`);
    for (const [k, v] of Object.entries(d.freeze.values)) L.push(`${k}: ${fmt(v)}`);
  } else L.push("No freeze frame stored (no confirmed fault).");

  L.push("", "== LIVE DATA (one snapshot) ==");
  L.push(`Engine running: ${d.engineRunning ? "yes" : "no"}`);
  for (const [k, v] of Object.entries(d.live)) L.push(`${k}: ${fmt(v)}`);

  if (d.sampled) {
    L.push("", `== RECORDED ${d.sampled.seconds} SECONDS (min / avg / max) ==`);
    for (const [k, s] of Object.entries(d.sampled.sensors)) {
      let line = s.unit === "C"
        ? `${k}: ${toF(s.min)} / ${toF(s.avg)} / ${toF(s.max)} F`
        : `${k}: ${r3(s.min)} / ${r3(s.avg)} / ${r3(s.max)} ${s.unit}`;
      if (s.switches !== undefined) line += `, switched ${s.switches}x across 0.45 V`;
      L.push(line);
    }
  }

  L.push("", "== EMISSIONS READINESS ==");
  if (d.readiness) {
    for (const [k, v] of Object.entries(d.readiness.monitors)) L.push(`${k}: ${v}`);
    L.push(`Not ready: ${d.readiness.notReady.join(", ") || "none"}`);
  } else L.push("not available");
  for (const [k, v] of Object.entries(d.sinceCleared)) L.push(`${k}: ${fmt(v)}`);

  L.push("", "Notes: generic OBD-II (engine/emissions only; no ABS/airbag). Fuel trims: positive = adding fuel (lean), negative = removing fuel (rich).");
  return L.join("\n");
}


// --------------------------------------------------------------------------- extra commands (read-only)
// The AI can ask for manufacturer-specific data (tire pressure, transmission, ABS...) by replying with a
// CARSCAN-COMMANDS block. Only read requests are allowed; anything that could clear codes, change settings,
// unlock or reprogram a module is blocked before it reaches the car.
const READ_SERVICES = new Set(["01", "02", "03", "05", "06", "07", "09", "0A", "18", "19", "1A", "21", "22"]);
const SAFE_AT = [
  /^ATSH[0-9A-F]{3}$/, /^ATSH[0-9A-F]{6}$/, /^ATCRA([0-9A-FX]{3}|[0-9A-FX]{8})?$/, /^ATCAF[01]$/,
  /^ATH[01]$/, /^ATS[01]$/, /^ATST[0-9A-F]{2}$/, /^ATAT[012]$/, /^ATAL$/, /^ATNL$/, /^ATDPN?$/, /^ATRV$/,
  /^ATI$/, /^ATCEA([0-9A-F]{2})?$/, /^ATFCSH[0-9A-F]{3,8}$/, /^ATFCSD[0-9A-F]{2,10}$/, /^ATFCSM[0-2]$/,
  /^ATTA[0-9A-F]{2}$/, /^ATSR[0-9A-F]{2}$/,
];
export const MAX_EXTRA_COMMANDS = 40;

export function checkCommand(raw) {
  const cmd = raw.toUpperCase().replace(/\s+/g, "");
  if (!cmd) return { ok: false, cmd, reason: "empty" };
  if (cmd.startsWith("AT")) {
    return SAFE_AT.some((re) => re.test(cmd)) ? { ok: true, cmd }
      : { ok: false, cmd, reason: "adapter setting not on the safe list" };
  }
  if (!/^([0-9A-F]{2}){1,14}$/.test(cmd)) return { ok: false, cmd, reason: "not a valid hex request" };
  const svc = cmd.slice(0, 2);
  if (svc === "04" || svc === "14") return { ok: false, cmd, reason: "would clear trouble codes" };
  if (!READ_SERVICES.has(svc)) return { ok: false, cmd, reason: `service ${svc} can change the car or unlock a module` };
  return { ok: true, cmd };
}

export function parseCommands(text) {
  let lines = text.replace(/\r/g, "").split("\n");
  const start = lines.findIndex((l) => /CARSCAN-COMMANDS/i.test(l));
  if (start >= 0) {
    lines = lines.slice(start + 1);
    const end = lines.findIndex((l) => /^\s*(END|```)\s*$/i.test(l));
    if (end >= 0) lines = lines.slice(0, end);
  }
  return lines
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("```") && !/^END$/i.test(l))
    .map((l) => {
      const [c, ...rest] = l.split(/\s*[|#]\s*/);
      return { raw: c.trim(), label: rest.join(" ").trim(), ...checkCommand(c) };
    })
    .slice(0, MAX_EXTRA_COMMANDS);
}

export async function runExtraCommands(elm, commands, onStep = () => {}) {
  const results = [];
  let i = 0;
  try {
    for (const c of commands) {
      i++;
      if (!c.ok) { results.push({ ...c, response: `BLOCKED (${c.reason})` }); continue; }
      onStep(`Running ${i} of ${commands.length}…`);
      const lines = await elm.cmd(c.cmd, 4000);
      results.push({ ...c, response: lines.join(" / ") || "(no reply)" });
    }
  } finally {
    // put the adapter back to normal so later reads still work
    try {
      await elm.cmd("ATD");
      for (const x of ["ATE0", "ATL0", "ATS0", "ATH0"]) await elm.cmd(x);
      await elm.cmd("0100", 8000);
    } catch {}
  }
  return results;
}

export function buildExtraReport(results, vin) {
  const L = [`EXTRA COMMAND RESULTS (${new Date().toLocaleString()})`, `VIN: ${vin || "unknown"}`, ""];
  for (const r of results) L.push(`${r.cmd}${r.label ? ` (${r.label})` : ""} -> ${r.response}`);
  L.push("", "Raw adapter replies. NO DATA or 7F xx 31/11/12 means the car didn't support that request.");
  return L.join("\n");
}

export const EXTRA_QUESTION = `Here are the results of the extra commands you asked for, run on the same car. Decode them into real values (show your math briefly), say which requests failed, and update your diagnosis. If something important is still missing, you can send one more CARSCAN-COMMANDS block.`;


// --------------------------------------------------------------------------- vehicle lookup (free NHTSA service)
export async function decodeVin(vin, timeoutMs = 5000) {
  if (!vin || vin.length !== 17) return null;
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), timeoutMs);
    const r = await fetch(`https://vpic.nhtsa.dot.gov/api/vehicles/DecodeVinValues/${vin}?format=json`, { signal: ctl.signal });
    clearTimeout(t);
    const v = (await r.json()).Results?.[0];
    if (!v?.Make) return null;
    const cap = (x) => x ? x.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase()) : "";
    const engine = [
      v.DisplacementL && `${(+v.DisplacementL).toFixed(1)}L`,
      v.EngineCylinders && `${v.EngineCylinders}-cyl`,
      v.EngineConfiguration?.startsWith("V") ? "V" : "",
      /turbo/i.test(`${v.Turbo} ${v.EngineModel}`) ? "turbo" : "",
      v.FuelTypePrimary && v.FuelTypePrimary !== "Gasoline" ? v.FuelTypePrimary.toLowerCase() : "",
      v.ElectrificationLevel && !/^$/.test(v.ElectrificationLevel) ? v.ElectrificationLevel.toLowerCase() : "",
    ].filter(Boolean).join(" ");
    return [v.ModelYear, cap(v.Make), v.Model, v.Trim].filter(Boolean).join(" ") + (engine ? ` (${engine})` : "");
  } catch { return null; }
}

// --------------------------------------------------------------------------- quick findings shown on screen
export function quickFindings(d) {
  const f = [];
  const add = (level, text) => f.push({ level, text });
  const live = d.live || {}, sc = d.sinceCleared || {};
  const all = [...new Set([...d.codes.stored, ...d.codes.pending, ...d.codes.permanent])];
  if (d.readiness?.mil) add("bad", "Check engine light is on.");
  if (d.codes.pending.length) add("warn", `Pending code${d.codes.pending.length > 1 ? "s" : ""} ${d.codes.pending.join(", ")}: detected but not confirmed yet.`);
  if (d.codes.permanent.length && !d.codes.stored.length) add("bad", "Permanent codes with no stored codes: codes were likely cleared without a fix.");
  const warm = sc.warmups_since_codes_cleared?.value, km = sc.distance_since_codes_cleared?.value;
  if ((warm !== undefined && warm < 10) || (km !== undefined && km < 160)) {
    add("bad", `Codes were cleared recently (${km !== undefined ? `${Math.round(km * 0.621)} miles` : `${warm} warm-ups`} ago).`);
  }
  if (d.readiness?.notReady?.length) add("warn", `${d.readiness.notReady.length} emissions self-test${d.readiness.notReady.length > 1 ? "s" : ""} not finished. May not pass inspection yet.`);
  for (const b of [1, 2]) {
    const lt = live[`long_fuel_trim_bank${b}`]?.value, st = live[`short_fuel_trim_bank${b}`]?.value ?? 0;
    if (lt === undefined) continue;
    if (lt + st > 15 || lt > 10) add("warn", `Engine is running lean${b === 2 ? " (bank 2)" : ""}: computer adding ${Math.round(lt + st)}% fuel.`);
    else if (lt + st < -15 || lt < -10) add("warn", `Engine is running rich${b === 2 ? " (bank 2)" : ""}: computer removing ${Math.round(-(lt + st))}% fuel.`);
  }
  const volts = live.control_module_voltage?.value;
  if (volts) {
    if (d.engineRunning && volts < 13.2) add("warn", `Charging voltage low (${volts.toFixed(1)} V). Check battery/alternator.`);
    else if (d.engineRunning && volts > 15.2) add("warn", `Charging voltage high (${volts.toFixed(1)} V).`);
    else if (!d.engineRunning && volts < 12.2) add("warn", `Battery is low (${volts.toFixed(1)} V with engine off).`);
  }
  const ct = live.coolant_temp?.value;
  if (ct !== undefined && ct > 108) add("bad", `Engine is hot (${Math.round((ct * 9) / 5 + 32)}°F). Stop and let it cool.`);
  const run = live.run_time_since_start?.value;
  if (ct !== undefined && d.engineRunning && run > 900 && ct < 70) add("warn", "Engine isn't warming up fully. Possible stuck-open thermostat.");
  const up = d.sampled?.sensors?.o2_bank1_sensor1_voltage, down = d.sampled?.sensors?.o2_bank1_sensor2_voltage;
  if (up?.switches >= 3 && down?.switches >= 3 && down.max - down.min > 0.4) add("warn", "Rear O2 sensor is copying the front one. Catalytic converter may be worn.");
  if (!d.engineRunning) add("info", "Engine was off. Start it and scan again for live data and a much better diagnosis.");
  if (!all.length && !f.some((x) => x.level !== "info")) add("ok", "No codes and nothing unusual in the readings.");
  return f;
}

// --------------------------------------------------------------------------- the message sent to the AI
export function buildMessage({ report, purpose, symptoms }) {
  const q = purpose === "buying" ? USED_CAR_QUESTION : QUESTION;
  const notes = symptoms?.trim() ? `\n\nWHAT THE OWNER NOTICES: ${symptoms.trim()}` : "";
  return `${q}${notes}\n\n${report}`;
}
