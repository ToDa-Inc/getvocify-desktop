# Building and releasing Vocify desktop

How the desktop app is built and how installed apps get new versions, as the repo is set up today (2026-10-08),
and what is still missing. The app is the **Electron app in [`app/`](../app/)**, Mac and Windows. The Swift app in
`apps/macos/` is legacy (see [`apps/macos/LEGACY.md`](../apps/macos/LEGACY.md)).

## Two kinds of changes

| What changed | Where it lives | How users get it |
|---|---|---|
| Dashboard screens, memos, calendar, briefs, backend | `getvocify` repo (dashboard + API) | **No app update.** The app loads the dashboard live from `https://staging.getvocify.com` (`app/main/src/main.ts`, `DEFAULT_DASHBOARD`). It shows on the next app start or page reload. |
| The island, the main process, the Mac helper (`app/native/mac-helper`), the window panel | this repo, `app/` | **Only with a new app build**, installed by hand or through auto-update (below). |

So: a dashboard or backend fix reaches every installed app once `getvocify` is deployed. An island or helper fix
needs a release from this repo.

## Building locally

### Mac (your own machine)

```bash
cd app
npm ci
npm run build:mac-native   # vocify-mac-helper + mac_panel.node (universal)
npm run dist:mac:local     # → app/release/mac-universal/Vocify.app
```

`dist:mac:local` builds without the hardened runtime and without notarization, signed with whatever local
certificate the keychain has (e.g. "Vocify Dev", `scripts/create-dev-signing-cert.sh`). That app runs on the
machine that built it.

Do **not** use `npm run dist:mac` with a local certificate: it turns the hardened runtime on, and macOS kills the
app at launch ("mapping process and mapped file have different Team IDs"). `dist:mac` is for builds signed with an
Apple Developer ID (CI).

A locally built app is a new app to macOS: it may ask again for the microphone, Screen & System Audio Recording,
and permission to control the browser.

### Windows

```bash
cd app
npm ci
npm run dist:win           # → app/release/Vocify-Setup-<version>.exe
```

The installer is unsigned: Windows shows "unknown publisher" on first run (More info → Run anyway). It installs
per user in `%LOCALAPPDATA%\Programs\Vocify`, no administrator rights.

### Checks before any build is shared

```bash
cd app
npm run typecheck
npm run test:logic         # core rules, controller, platform contracts
npm run test:island        # every island screen rendered in a real window, sizes and cut text checked
```

## How installed apps update

`app/main/src/updater.ts` (electron-updater):

- Checks GitHub Releases of `ToDa-Inc/getvocify-desktop` at start and every 30 minutes, pre-releases included
  (`app/electron-builder.yml`, `publish`: GitHub, `releaseType: prerelease`).
- Downloads a newer version in the background and installs it when nothing is recorded or reviewed; otherwise it
  waits, or installs on the next quit.
- "Newer" means a higher version number. CI sets each build's version to `0.4.<workflow run number>`; a local build
  keeps `0.4.0` from `package.json`.
- Windows reads `latest.yml` from the release; Mac reads `latest-mac.yml`. A release without the platform's file
  gives that platform nothing (the Mac app logs "Cannot find latest-mac.yml" on every check today).

## The CI workflows today

| Workflow | Builds | Runs on | Publishes a release? |
|---|---|---|---|
| `windows-app.yml` ("Windows app") | Electron Windows installer, after logic, island, real-input and install tests | push to **`feat/electron`** (paths `app/**`), or manual | **Only on push**, so only from `feat/electron`. A manual run (e.g. on `main`) builds and keeps the installer as a run artifact (`Vocify-Windows`) but publishes nothing. |
| `mac-app.yml` ("macOS app") | Electron Mac app, signed with the Developer ID from secrets (`APPLE_CERTIFICATE_BASE64`, `APPLE_CERTIFICATE_PASSWORD`), notarized when `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID` are set | manual only | **Never.** The build is a run artifact (`Vocify-macOS`); no `latest-mac.yml` is published. |
| `release-mac.yml` ("Release Mac") | legacy Swift app DMG, against the staging API | push to `main` touching `apps/macos/**`, daily, `v*` tags | Only for `v*` tags. |
| `release-windows.yml` | legacy WPF shell (`apps/windows`) | push to `main` touching `apps/windows/**` | No. |

### What that means right now

- **Windows users** stay on the last published release, **0.4.26 (2026-10-07)**. Everything merged into `main`
  since then (island fixes, meeting heads-up, browser warning, speaker names) is not offered to them, because
  `main` never publishes.
- **Mac users of the Electron app** never auto-update; they get a new version only when someone gives them a new
  build (a local `dist:mac:local` build, or the `Vocify-macOS` artifact of a manual `mac-app.yml` run).
- **Users of the Swift app** have no updater at all; they should move to the Electron app.
- In every case, dashboard and backend changes reach them without an update.

## How to ship an app change today (with what exists)

1. Merge to `main` with `typecheck`, `test:logic` and `test:island` green.
2. **Windows:** run "Windows app" manually on `main` (Actions → Windows app → Run workflow) and hand out the
   `Vocify-Windows` artifact; or push `main`'s commit to `feat/electron` so the push publishes a pre-release that
   installed apps pick up within 30 minutes.
3. **Mac:** run "macOS app" manually on `main` and hand out the `Vocify-macOS` artifact, or build locally with
   `dist:mac:local` for your own machine.

## What is missing (not done)

These are the changes that would make "merge to `main`" reach installed apps on its own. None is in place yet.

1. **Windows: publish from `main`.** In `windows-app.yml`, change the push trigger from `feat/electron` to `main`
   (paths `app/**`). The publish step already runs only after the installer was installed and started in CI, so a
   broken build is never offered. Held back on purpose until an installer from `main` was tested by hand
   (decision 2026-10-07): every push would then go to all installed Windows apps.
2. **Mac: publish the signed build.** In `mac-app.yml`, add the same publish step (`electron-builder … --publish
   always` with `GH_TOKEN`) so `latest-mac.yml` and the zip are in the release. Mac auto-update only accepts a
   build signed with the same Developer ID and notarized, so the Apple secrets above must be set in the repo
   (not verified here: listing the repo's secrets needs admin access).
3. **One version for both.** Both workflows version builds from their own run number (`0.4.<run>`); publishing both
   into the same releases needs one shared number (e.g. the commit count, or one workflow building both).
