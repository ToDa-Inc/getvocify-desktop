# Vocify desktop dev

> **Vocify desktop is the Electron app in [`app/`](app/)**, on Mac and Windows. All new desktop and island work goes there.
> The Swift app in [`apps/macos/`](apps/macos/) is **legacy**: no new features, only kept until the Electron Mac app takes over
> its release ([`.github/workflows/release-mac.yml`](.github/workflows/release-mac.yml) still builds it). The Electron Mac app
> (native helper `app/native/mac-helper`, `cd app && npm run dist:mac`) is on `main`.

Native Mac shell: `apps/macos/` · Dashboard (React): `~/getvocify`

## Daily loop

```bash
# 1. Edit dashboard (meeting UI, permissions panel, memos, …)
cd ~/getvocify && npm run dev

# 2. Rebuild + open native app (embeds dashboard build)
~/getvocify-desktop/scripts/dev-desktop.sh
```

After granting **system audio**, **⌘Q and reopen once** (ScreenCaptureKit quirk).

## Permissions

Mic and system audio use **macOS system prompts** (`AVCaptureDevice.requestAccess`, `CGRequestScreenCaptureAccess`).
Settings opens only if you previously denied access.

## Signing

Ad-hoc builds cannot use **Screen & System Audio Recording**. Create a local cert once:

```bash
bash scripts/create-dev-signing-cert.sh
CODESIGN_IDENTITY="Vocify Dev" ./scripts/dev-desktop.sh
```

Distribution entitlements live in `apps/macos/entitlements/`. CI and release builds use
`distribution.plist` (no debugger entitlement). Local debugging can set `VOCIFY_DEV_SIGN=1` for
`development.plist`.

Teammate installs: [docs/INSTALL.md](docs/INSTALL.md).

## Tests

```bash
cd ~/getvocify && node --experimental-strip-types --test src/lib/desktop-permissions.test.ts
cd ~/getvocify-desktop/apps/macos && swift run VocifyCoreChecks
```

## Where things live

| Path | What |
|------|------|
| `~/getvocify/src/features/desktop/` | Meeting recorder, permissions UI, drafts |
| `apps/macos/Sources/VocifyCompanion/` | WKWebView shell, bridge, ScreenCaptureKit |
