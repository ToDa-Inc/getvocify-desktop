# Working in this repo

**The desktop app is the Electron app in `app/`** (Mac and Windows). Build every desktop or island feature there:

- Island UI: `app/island/src`, its logic: `app/main/src/controller.ts`, shared rules: `app/core`.
- OS work: `app/main/src/platform` (one interface per job, Mac and Windows implementations).
- Native Mac code: the helper `app/native/mac-helper` (one command per job, documented in its `PROTOCOL.md`).
- In Electron the dashboard page records and transcribes, so per-line meeting logic lives in the dashboard repo
  (`getvocify`, `src/features/desktop/DesktopMeetingProvider.tsx`, the non-native path).
- The Electron Mac app is on `main` (`cd app && npm run build:mac-native && npm run dist:mac`).
- Checks: `cd app && npm run typecheck && npm run test:logic && npm run test:island`.

**`apps/macos/` (Swift) is legacy.** Do not build features there; see `apps/macos/LEGACY.md`. Also legacy: the old
WPF shell `apps/windows/`.
