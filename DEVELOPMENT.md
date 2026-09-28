# Vocify desktop dev

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

## Signing (optional)

Ad-hoc builds work for trying prompts. For **system audio to persist across rebuilds**, sign the app
(stable code identity). Easiest: Xcode → Signing & Capabilities → your Apple ID.

```bash
bash scripts/ensure-dev-signing.sh   # lists identities if any
```

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
