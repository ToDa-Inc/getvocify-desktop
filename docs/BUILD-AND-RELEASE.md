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
- "Newer" means a higher version number. CI sets each build's version to `0.4.<commit count of main>`; a local build
  keeps `0.4.0` from `package.json`.
- Windows reads `latest.yml` from the release; Mac reads `latest-mac.yml`. A release without the platform's file
  gives that platform nothing.

## The CI workflow: `desktop-app.yml` ("Desktop app")

One workflow builds Windows and Mac from the same commit with the same version, then publishes both in **one** GitHub
pre-release. It runs on every push to `main` that changes `app/**`, or by hand (Actions → Desktop app → Run workflow;
the `publish` box decides whether the result is released, off by default).

| Job | Does | Output |
|---|---|---|
| `windows` | logic, Windows-registry, island, focus, real-input, call-audio and whole-call tests; builds the installer; installs it and starts it once | artifact `Vocify-Windows`: installer, blockmap, `latest.yml` |
| `mac` | logic tests; builds the native helper; builds, signs and notarizes the universal app | artifact `Vocify-macOS`: dmg, zip, blockmaps, `latest-mac.yml` |
| `publish` | only when both jobs passed, and only on a push (or a manual run with `publish` on): creates release `v<version>` with both systems' files | the release installed apps read |

- **Version:** `0.4.<commit count of main>`. It only grows on `main`, and both systems get the same number. (A
  per-workflow run number would restart at 1 in a new workflow and installed apps would never see it as newer.)
- **Mac needs the Apple secrets** (`APPLE_CERTIFICATE_BASE64`, `APPLE_CERTIFICATE_PASSWORD`, `APPLE_ID`,
  `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`). Without all five, the Mac build is for hand-testing only: the
  release then holds Windows files only, because macOS refuses to update to an app that is not signed with the same
  Developer ID and notarized. A warning in the run says so.
- The legacy Swift app has its own workflows (`release-mac.yml`, `release-windows.yml`); they do not touch the
  Electron app.

### What that means

- A merge to `main` that changes `app/` reaches every installed Windows app within 30 minutes of the workflow
  finishing, and every installed Mac app too once the Apple secrets are set.
- Dashboard and backend changes need no release at all.
- To hand someone a build without releasing: run the workflow by hand with `publish` off and send the
  `Vocify-Windows` or `Vocify-macOS` artifact. A local Mac build (`dist:mac:local`) runs only on the machine that made it.
- To stop a bad release reaching people: delete the release on GitHub; apps look at the newest release.

## What is missing

- Apple Developer ID secrets in the repo (not verified: listing secrets needs admin access).
- Windows installers are unsigned ("unknown publisher" on first install). Auto-update works without a signature.
