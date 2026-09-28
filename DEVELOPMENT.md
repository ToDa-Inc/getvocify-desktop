# Developing Vocify for Mac

One native app (`apps/macos`), one dashboard repo (`~/getvocify`). No nested clones, no Electron for daily Mac work.

## Signing (required for system audio)

Local builds default to **ad-hoc** signing. macOS **will not list** ad-hoc apps in
**Screen & System Audio Recording** — Settings looks empty and permissions cannot stick
(Apple TN3127). This is not a Vocify bug.

```bash
bash scripts/ensure-dev-signing.sh   # checks / instructions
# After creating "Vocify Dev" Code Signing cert in Keychain:
CODESIGN_IDENTITY="Vocify Dev" ./scripts/dev-desktop.sh
```

Then Vocify appears in Settings and the drag-to-allow flow works.

## Daily loop

```bash
# 1. Edit dashboard (meeting UI, permissions panel, memos, …)
cd ~/getvocify
# … edit src/features/desktop/, etc.

# 2. Rebuild and open the Mac app
cd ~/getvocify-desktop
./scripts/dev-desktop.sh
```

After an **unsigned** rebuild, macOS treats the app as new — use a signed build (see above) or permissions cannot stick. After granting system audio on a **signed** build, **⌘Q and reopen once**.

## Hot reload (faster UI iteration)

Skip embedding the dashboard — point the shell at Vite:

```bash
# Terminal 1
cd ~/getvocify && npm run dev

# Terminal 2
cd ~/getvocify-desktop/apps/macos && swift build -c release
VOCIFY_WEB_ORIGIN=http://localhost:8080 \
  .build/release/VocifyCompanion   # binary name in SwiftPM; packaged as Vocify.app/Contents/MacOS/Vocify
```

Native bridge changes (permissions, system audio) still need `swift build` or `dev-desktop.sh`.

## Checks

```bash
cd ~/getvocify-desktop/apps/macos && swift run VocifyCoreChecks
cd ~/getvocify && node --experimental-strip-types --test src/lib/meeting-transcript.test.ts src/lib/desktop-permissions.test.ts
cd ~/getvocify/backend && .venv/bin/python -m pytest tests/test_upload_transcript.py -q
```

## Repo layout

| Path | What |
|------|------|
| `apps/macos/` | **Main Mac app** — Swift shell + embedded dashboard |
| `~/getvocify/src/features/desktop/` | Meeting recorder, permissions UI, drafts |
| Electron at repo root | Legacy; not used for Mac shipping |

## Branches

- **getvocify-desktop:** `feat/native-mac-recorder`
- **getvocify:** `feat/desktop-meeting-recorder`

Keep desktop work on those branches until merged to `main`.
