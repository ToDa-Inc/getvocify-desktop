# Try Vocify on Windows

A Windows build of the Electron app is produced by GitHub Actions on every push to `feat/electron` (workflow **Windows app**).

## 1. Get the installer

1. Open <https://github.com/ToDa-Inc/getvocify-desktop/actions/workflows/windows-app.yml> and open the latest green run.
2. Under **Artifacts**, download **Vocify-Windows**. Unzip it: it holds `Vocify-Setup-0.4.0.exe` (about 78 MB).
3. Run it. Windows shows "Windows protected your PC" because the installer is not signed yet: choose **More info**, then **Run anyway**.
4. It installs for your user only (no administrator rights) into `%LOCALAPPDATA%\Programs\Vocify` and starts. The island appears at the top centre of the screen.

On a company-managed PC an unsigned installer may be blocked by policy; try it on a personal machine first.

## 2. Try it without signing in (demo)

Open PowerShell and run:

```powershell
& "$env:LOCALAPPDATA\Programs\Vocify\Vocify.exe" --demo
```

A small window of buttons stands in for call detection ("Zoom takes the mic", "The call app lets go"), and a stand-in dashboard answers the island. Click the island, press Record, watch the transcript, Stop, and use the after-call card. Nothing is recorded.

## 3. Use the real dashboard

The production dashboard does not know Windows yet. The branch `feat/desktop-windows` of `ToDa-Inc/getvocify` adds it and already has a Vercel preview:

```
https://getvocify-b9cvrknpn-danis-projects-c38305cd.vercel.app
```

Start the app pointed at it (any one of these):

```powershell
& "$env:LOCALAPPDATA\Programs\Vocify\Vocify.exe" --dashboard=https://getvocify-b9cvrknpn-danis-projects-c38305cd.vercel.app
```

or set `{ "dashboardUrl": "https://getvocify-b9cvrknpn-danis-projects-c38305cd.vercel.app" }` in `%APPDATA%\Vocify\config.json`, or the `VOCIFY_DASHBOARD_URL` environment variable.

The preview is behind a Vercel sign-in: the first time, sign in to Vercel in the app window (it stays inside the app), then sign in to Vocify. Once the branch is merged and deployed, none of this is needed.

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

## What is and is not proven

Proven on a real Windows runner (see the workflow): the installer builds, installs and starts; the island layout (58 checks); the call-audio pipeline with a synthetic tone; a whole call through the shell; the microphone-use record is read and parsed from the real registry; a real Chrome's address bar is read through UI Automation.

Not proven: capturing a real call's audio from a real Windows audio device, real microphone use by Zoom/Teams being picked up by the registry record, focus behaviour with a real call window in front, and anything on a company-managed PC. Those need your test.
