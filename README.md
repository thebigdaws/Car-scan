# Car Scan

Scan your car with a $30 Bluetooth OBD-II adapter and send the report to ChatGPT, Claude or Gemini. A free web app: no App Store, no account, no server. Your car's data stays on your phone until you share it.

Read-only. It can't clear codes or change anything on the car.

## What you need

- A **Bluetooth LE** OBD-II adapter, e.g. **Veepeak OBDCheck BLE** (must say BLE)
- **iPhone:** the free **Bluefy** browser from the App Store (Safari can't use Bluetooth)
- **Android:** Chrome
- A gas or hybrid car, 1996 or newer (US). Fully electric cars have no OBD-II engine data.

## Put it online with GitHub Pages (free, one time)

1. Sign in at github.com, click **+** (top right) → **New repository**. Name it `car-scan`, set it to **Public**, click **Create repository**.
2. On the new repo page, click **uploading an existing file**. Drag in every file from this folder (`index.html`, `obd.js`, `mock.js`, `manifest.json`, the three `.png` icons, `.nojekyll` and this README). Click **Commit changes**.
   (`.nojekyll` is hidden on Windows if file extensions are hidden; if you can't see it, skip it.)
3. Go to **Settings → Pages**. Under **Branch**, pick `main` and `/ (root)`, click **Save**.
4. Wait a minute. Your app is at `https://YOUR-USERNAME.github.io/car-scan/`

## Use it on your iPhone

1. Open **Bluefy** and go to your app's address. Tap the share/menu icon to bookmark it.
2. Try it first: tap **Simulated** → **Scan car**. No adapter needed.
3. Real car: plug the adapter in under the dashboard, turn the ignition ON (start the engine for live data), tap **My car** → **Scan car**, and pick the adapter from the list. **Don't** pair it in iPhone Bluetooth settings first.
4. Tap **Share report…** and choose Claude, ChatGPT or Gemini. Tap Send.
   If sharing doesn't show up, tap **Claude / ChatGPT / Gemini** under "Or copy & open": the report is copied, paste it in.

**Buying it?** switches the question to a used-car check: buy, negotiate or walk away.

**What do you notice?** (optional): type symptoms like "rough idle" or "smells like gas". They're sent to the AI with the scan.

**More data:** if the AI replies with a `CARSCAN-COMMANDS` block (tire pressure, transmission, ABS…), paste its reply into the More data box and tap Run commands. Only read-only commands run; anything that could change the car is blocked.

**Past scans** are saved on your phone only, so you can compare before and after a fix.

**Add to Home Screen** for an app icon (Android Chrome; on iPhone, use Bluefy's bookmark/home-screen option if available).

## Files

| File | What it is |
|---|---|
| `index.html` | The app screen |
| `obd.js` | Bluetooth connection, ELM327 decoding, the report and the AI instructions |
| `mock.js` | Simulated cars for testing without an adapter |
| `manifest.json`, `*.png` | App name and home-screen icons |

## Troubleshooting

- **"This browser can't use Bluetooth"**: on iPhone, open the page in Bluefy, not Safari or Chrome.
- **Adapter not in the list**: make sure it's plugged in with the ignition ON, and that it isn't connected to another app.
- **"The car didn't answer"**: ignition isn't ON, or the adapter isn't pushed all the way in.
- **Codes but no live data**: start the engine.

*Informational only. Not a substitute for a professional inspection. You're responsible for repair decisions.*
