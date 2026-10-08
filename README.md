# Vocify for Mac

> **Vocify desktop is the Electron app in [`app/`](app/)**, on Mac and Windows. All new desktop and island work goes there.
> The Swift app in [`apps/macos/`](apps/macos/) is **legacy**: no new features, only kept until the Electron Mac app takes over
> its release ([`.github/workflows/release-mac.yml`](.github/workflows/release-mac.yml) still builds it). The Electron Mac app
> (native helper `app/native/mac-helper`, `cd app && npm run dist:mac`) is on `main`.

Native macOS app with the Vocify dashboard embedded — records Zoom, Meet, and Teams without a bot. Your mic is **You**, system audio is **Them**. Talks to **https://api.getvocify.com/api/v1**.

**Requires macOS 14+.**

## Install (teammates)

See **[docs/INSTALL.md](docs/INSTALL.md)** — download a DMG from [Releases](https://github.com/ToDa-Inc/getvocify-desktop/releases) or build locally with a signing cert.

Quick start after install:

1. Sign in with your Vocify account.
2. **New Memo → Record meeting** (or **⌘R**).
3. Allow **Microphone** and **Screen & System Audio Recording**.
4. **Quit and reopen Vocify once** after granting system audio.
5. Stop recording to review and approve the memo in the CRM.

## Build from source (developers)

Dashboard repo required at `~/getvocify` (or set `GETVOCIFY_ROOT`).

```bash
cd getvocify-desktop
bash scripts/create-dev-signing-cert.sh          # once per machine
CODESIGN_IDENTITY="Vocify Dev" ./scripts/dev-desktop.sh
```

`build-app.sh` bundles the dashboard from `GETVOCIFY_REF` (default `staging` on `ToDa-Inc/getvocify`).

```bash
bash apps/macos/scripts/package-dmg.sh         # → dist/Vocify-macos.dmg
```

## Development

See [DEVELOPMENT.md](DEVELOPMENT.md).

- Hot dashboard: `npm run dev` in `~/getvocify`, then  
  `VOCIFY_WEB_ORIGIN=http://localhost:8080 Vocify.app/Contents/MacOS/Vocify`
- Core checks: `cd apps/macos && swift run VocifyCoreChecks`
- CI: `.github/workflows/release-mac.yml` builds on push to `main` and publishes DMG on `v*` tags

## Windows

Legacy WPF shell at `apps/windows/VocifyCompanion` — not the primary Mac product.

```bash
dotnet publish apps/windows/VocifyCompanion/VocifyCompanion.csproj -c Release -r win-x64 --self-contained -o dist/windows
```
