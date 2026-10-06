# Try Vocify on Windows

A Windows build of the Electron app is produced by GitHub Actions on every push to `feat/electron` (workflow **Windows app**).

## 1. Get the installer

Every build that passes the Windows checks is published as a pre-release at <https://github.com/ToDa-Inc/getvocify-desktop/releases>.

1. Open the newest release and download `Vocify-Setup-<version>.exe` (about 78 MB).
2. Run it. Windows shows "Windows protected your PC" because the installer is not signed yet: choose **More info**, then **Run anyway**.
3. It installs for your user only (no administrator rights) into `%LOCALAPPDATA%\Programs\Vocify` and starts. The island appears at the top centre of the screen.

**You install once.** After that the app checks GitHub every 30 minutes (and at start), downloads a newer build in the background and restarts into it as soon as no meeting is being recorded and no call update is on screen; if you are busy it waits, and installs when you quit. The log line `update: ...` in `%APPDATA%\Vocify\logs\vocify.log` says what it did. Set the environment variable `VOCIFY_NO_UPDATE=1` to switch it off.

On a company-managed PC an unsigned installer may be blocked by policy; try it on a personal machine first.

## 2. Try it without signing in (demo)

Open PowerShell and run:

```powershell
& "$env:LOCALAPPDATA\Programs\Vocify\Vocify.exe" --demo
```

A small window of buttons stands in for call detection ("Zoom takes the mic", "The call app lets go"), and a stand-in dashboard answers the island. Click the island, press Record, watch the transcript, Stop, and use the after-call card. Nothing is recorded.

## 3. Which dashboard it opens

The live site `app.getvocify.com` (branch `main`) has no island or desktop-bridge code, so on it the island can never learn that you are signed in. Until that code is deployed there, the app opens the staging site `https://staging.getvocify.com` by default (it has the bridge, and is behind a Vercel sign-in: the first time you see a Vercel login inside the app, then the Vocify one). Staging does not know Windows yet, so the app tells it the platform name it understands (compatibility mode); only a few permission messages use Mac wording.

If the island still says signed out after you sign in, the log (`%APPDATA%\Vocify\logs\vocify.log`) tells why: a line `dashboard says signed in` means the dashboard reported your session; no such line means the page did not talk to the app.

Other addresses: `--dashboard=<url>`, `{ "dashboardUrl": "..." }` in `%APPDATA%\Vocify\config.json`, or `VOCIFY_DASHBOARD_URL`. The Windows-aware dashboard change is the branch `feat/desktop-windows` of `ToDa-Inc/getvocify`; once merged and deployed, add `--platform=win32` to turn the compatibility off.

## 4. What to check

| Check | Expected |
|---|---|
| Microphone | If Windows Settings > Privacy & security > Microphone > "Let desktop apps access your microphone" is off, the dashboard says so and offers to open that page. |
| Call detection | Start a Zoom, Teams, Meet (in Chrome or Edge) or HubSpot call: within about a second the island drops down with that app's own icon and Record. |
| CRM contact | With the HubSpot or Pipedrive contact open in a browser window (the active tab), the island shows the contact's name. A CRM tab hidden behind another tab of the same window is not read. |
| Recording | Record from the island: your mic is "You", the call's audio is "Them", the transcript streams into the island. |
| After the call | Stop (5 s to undo), then the CRM update card: Save, Review in Vocify, Email, Notes. |
| Focus | Clicking the island must never take focus from the call window. |

Logs: `%APPDATA%\Vocify\logs\vocify.log`. Quit from the tray icon. Memory with the dashboard open is about 600 MB; the island alone is about 230 MB.

## How close the look is to the Mac app

Same layout, sizes, colours, copy and behaviour, ported from the Swift code and checked state by state. Known differences: no blur behind the glass (the open island is a denser dark instead), the system font is Segoe UI instead of SF Pro, the icons are drawn as SVG instead of SF Symbols, the open and close motion is a close approximation of the spring, and there is no notch on Windows, so the island is a pill at the top centre of the screen.

## What is and is not proven

Proven on a real Windows runner (see the workflow): a real mouse click on the island acts on the first press and leaves the foreground window unchanged; the installer builds, installs and starts; the island layout (58 checks); the call-audio pipeline with a synthetic tone; a whole call through the shell; the microphone-use record is read and parsed from the real registry; a real Chrome's address bar is read through UI Automation.

Not proven: capturing a real call's audio from a real Windows audio device, real microphone use by Zoom/Teams being picked up by the registry record, the island over a fullscreen call window, 200% display scaling and several monitors, the open states side by side with the Swift app, and anything on a company-managed PC. Those need your test.
