// A fake car that speaks raw ELM327, so the real decoding code runs without any hardware.

const clamp = (v) => Math.max(0, Math.min(255, Math.round(v)));
const b = (...xs) => xs;
const u16 = (v) => { const n = Math.round(v); return b((n >> 8) & 0xff, n & 0xff); };
const pct = (v) => b(clamp((v * 255) / 100));
const temp = (v) => b(Math.round(v) + 40);
const trim = (v) => b(clamp((v * 128) / 100 + 128));
const u8 = (v) => b(Math.round(v));
const o2 = (v) => b(clamp(v * 200), 0xff);
const ENC = {
  0x04: pct, 0x05: temp, 0x06: trim, 0x07: trim, 0x08: trim, 0x09: trim, 0x0b: u8, 0x0c: (v) => u16(v * 4),
  0x0d: u8, 0x0e: (v) => b(Math.round((v + 64) * 2)), 0x0f: temp, 0x10: (v) => u16(v * 100), 0x11: pct,
  0x14: o2, 0x15: o2, 0x1f: u16, 0x21: u16, 0x2f: pct, 0x30: u8, 0x31: u16, 0x33: u8,
  0x42: (v) => u16(v * 1000), 0x46: temp, 0x4d: u16, 0x4e: u16, 0x5c: temp,
};
const n = (s) => (Math.random() * 2 - 1) * s;
const wave = (period, phase = 0) => 0.5 + 0.5 * Math.tanh(4 * Math.sin((2 * Math.PI * performance.now()) / 1000 / period + phase));

export const SCENARIOS = {
  lean_vacuum_leak: {
    label: "Check engine light, rough idle",
    vin: "1HGCP2F31BA012345", mil: true, stored: ["P0171", "P0174"], pending: [], permanent: ["P0171"],
    freeze: { code: "P0171", 0x04: 21, 0x05: 89, 0x06: 9.4, 0x07: 18.0, 0x08: 7.8, 0x09: 16.4, 0x0b: 31, 0x0c: 760, 0x0d: 0, 0x0f: 24, 0x10: 2.3, 0x11: 14 },
    notReady: [], sinceClear: { 0x30: 112, 0x31: 2650, 0x4e: 5200, 0x21: 410, 0x4d: 690 },
    live: () => ({ 0x04: 22 + n(2), 0x05: 89 + n(1), 0x06: 6 + n(4), 0x07: 18.0, 0x08: 5 + n(4), 0x09: 16.4,
      0x0b: 32 + n(2), 0x0c: 720 + n(45), 0x0d: 0, 0x0e: 9 + n(3), 0x0f: 24, 0x10: 2.3 + n(0.2), 0x11: 14,
      0x14: 0.12 + 0.55 * wave(2.6) * (Math.random() > 0.35), 0x15: 0.22 + n(0.04), 0x2f: 58, 0x42: 14.1 + n(0.1),
      0x46: 12, 0x1f: 340, 0x33: 101 }),
  },
  bad_catalyst: {
    label: "Failed emissions test",
    vin: "4T1BF1FK5CU512345", mil: true, stored: ["P0420"], pending: [], permanent: ["P0420"],
    freeze: { code: "P0420", 0x04: 34, 0x05: 91, 0x06: 1.6, 0x07: 2.3, 0x0b: 46, 0x0c: 2150, 0x0d: 72, 0x0f: 27, 0x10: 14.8, 0x11: 19 },
    notReady: [], sinceClear: { 0x30: 205, 0x31: 6100, 0x4e: 9800, 0x21: 1880, 0x4d: 2950 },
    live: () => ({ 0x04: 24 + n(2), 0x05: 90 + n(1), 0x06: n(3), 0x07: 2.3, 0x0b: 30 + n(2), 0x0c: 700 + n(15),
      0x0d: 0, 0x0e: 11 + n(2), 0x0f: 26, 0x10: 2.9 + n(0.15), 0x11: 15, 0x14: 0.1 + 0.75 * wave(1.4),
      0x15: 0.15 + 0.6 * wave(1.4, -0.4), 0x2f: 40, 0x42: 14.2 + n(0.1), 0x46: 14, 0x1f: 610, 0x33: 101 }),
  },
  recently_cleared: {
    label: "Used car for sale, light off",
    vin: "1FMCU0GX5EUB12345", mil: false, stored: [], pending: ["P0420"], permanent: [],
    freeze: null, notReady: ["catalyst", "evap_system", "oxygen_sensor"],
    sinceClear: { 0x30: 3, 0x31: 14, 0x4e: 38, 0x21: 0, 0x4d: 0 },
    live: () => ({ 0x04: 25 + n(2), 0x05: 88 + n(1), 0x06: n(3), 0x07: 1.6, 0x0b: 31 + n(2), 0x0c: 690 + n(15),
      0x0d: 0, 0x0e: 10 + n(2), 0x0f: 20, 0x10: 3.1 + n(0.15), 0x11: 15, 0x14: 0.1 + 0.75 * wave(1.5),
      0x15: 0.3 + 0.35 * wave(1.5, -0.3), 0x2f: 22, 0x42: 13.9 + n(0.1), 0x46: 9, 0x1f: 450, 0x33: 100 }),
  },
  healthy: {
    label: "Healthy car",
    vin: "YV4162UK5K2012345", mil: false, stored: [], pending: [], permanent: [],
    freeze: null, notReady: [], sinceClear: { 0x30: 255, 0x31: 13600, 0x4e: 65535, 0x21: 0, 0x4d: 0 },
    live: () => ({ 0x04: 20 + n(2), 0x05: 92 + n(1), 0x06: n(2), 0x07: 0.8, 0x0b: 30 + n(2), 0x0c: 650 + n(10),
      0x0d: 0, 0x0e: 12 + n(2), 0x0f: 22, 0x10: 3.4 + n(0.1), 0x11: 13, 0x14: 0.1 + 0.75 * wave(1.2),
      0x15: 0.66 + n(0.03), 0x2f: 71, 0x42: 14.3 + n(0.05), 0x46: 15, 0x1f: 920, 0x33: 101, 0x5c: 95 }),
  },
};

const MON_BITS = { catalyst: 0, heated_catalyst: 1, evap_system: 2, secondary_air: 3, oxygen_sensor: 5, oxygen_sensor_heater: 6, egr_system: 7 };
const H = (bytes) => bytes.map((x) => x.toString(16).toUpperCase().padStart(2, "0")).join("");
const codeBytes = (c) => b(("PCBU".indexOf(c[0]) << 6) | (parseInt(c[1]) << 4) | parseInt(c[2], 16), parseInt(c.slice(3), 16));

export class MockTransport {
  constructor(name = "lean_vacuum_leak") { this.s = SCENARIOS[name]; this.simulated = true; this.name = "Simulated car"; }
  async open() { await new Promise((r) => setTimeout(r, 400)); }
  async close() {}
  values() { return { ...this.s.live(), ...this.s.sinceClear }; }

  bitmap(base) {
    const pids = new Set([...Object.keys(this.values()).map(Number), 0x01]);
    let bits = 0;
    for (let i = 0; i < 32; i++) {
      const p = base + i + 1;
      if (pids.has(p) || (i === 31 && [...pids].some((x) => x > p))) bits += 2 ** (31 - i);
    }
    return b((bits >>> 24) & 0xff, (bits >>> 16) & 0xff, (bits >>> 8) & 0xff, bits & 0xff);
  }

  answer(cmd) {
    const s = this.s;
    if (cmd.startsWith("AT")) {
      return { ATZ: "ELM327 v1.5", ATI: "ELM327 v1.5 (simulated car)", ATDPN: "A6",
        ATRV: `${(this.values()[0x42] ?? 12.6).toFixed(1)}V` }[cmd] || "OK";
    }
    const mode = cmd.slice(0, 2), rest = cmd.slice(2);
    if (mode === "01") {
      const pid = parseInt(rest, 16);
      let data;
      if (pid % 0x20 === 0) data = this.bitmap(pid);
      else if (pid === 0x01) {
        let d = 0;
        for (const m of s.notReady) d |= 1 << MON_BITS[m];
        data = b((s.mil ? 0x80 : 0) | s.stored.length, 0x07, 0x01 | 0x04 | 0x20 | 0x40, d);
      } else {
        const v = this.values()[pid];
        if (v === undefined || !ENC[pid]) return "NO DATA";
        data = ENC[pid](v);
      }
      return "41" + H([pid]) + H(data);
    }
    if (mode === "02") {
      const pid = parseInt(rest.slice(0, 2), 16), fz = s.freeze;
      if (!fz) return pid === 0x02 ? "4202000000" : "NO DATA";
      if (pid === 0x02) return "420200" + H(codeBytes(fz.code));
      if (fz[pid] !== undefined && ENC[pid]) return "42" + H([pid]) + "00" + H(ENC[pid](fz[pid]));
      return "NO DATA";
    }
    if (["03", "07", "0A"].includes(mode)) {
      const codes = s[{ "03": "stored", "07": "pending", "0A": "permanent" }[mode]];
      return H([parseInt(mode, 16) + 0x40, codes.length, ...codes.flatMap(codeBytes)]);
    }
    if (cmd === "0902") {
      const blob = H([0x49, 0x02, 0x01, ...[...s.vin].map((c) => c.charCodeAt(0))]);
      const frames = [blob.slice(0, 12)];
      for (let i = 12; i < blob.length; i += 14) frames.push(blob.slice(i, i + 14));
      return "014\r" + frames.map((f, i) => `${i}:${f}`).join("\r");
    }
    return "NO DATA";
  }

  async send(cmd) {
    await new Promise((r) => setTimeout(r, 15));
    return this.answer(cmd.trim().toUpperCase()) + "\r\r>";
  }
}
