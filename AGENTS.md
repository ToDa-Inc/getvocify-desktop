# Working in this repo

## Branches and pull requests: commit to `main`

- **No pull requests.** Don't open one, even to merge your own work.
- **No new branch or worktree** unless Dani asks for one. Work in the main checkout on `main`, commit, `git pull --rebase`,
  run the checks, and `git push`.
- Several sessions work in this folder at once. Commit only your own files (`git add <paths>`, never `git add -A`).
  Never commit, revert or stash another session's changes (the stash is shared by every session).
- If you were asked for a branch: when the work is done, merge it into `main` yourself (`git merge`, then push),
  delete the branch locally and on GitHub, and remove its worktree. Nothing is left behind.

**The desktop app is the Electron app in `app/`** (Mac and Windows). Build every desktop or island feature there:

- Island UI: `app/island/src`, its logic: `app/main/src/controller.ts`, shared rules: `app/core`.
- OS work: `app/main/src/platform` (one interface per job, Mac and Windows implementations).
- Native Mac code: the helper `app/native/mac-helper` (one command per job, documented in its `PROTOCOL.md`).
- In Electron the dashboard page records and transcribes, so per-line meeting logic lives in the dashboard repo
  (`getvocify`, `src/features/desktop/DesktopMeetingProvider.tsx`, the non-native path).
- The Electron Mac app is on `main`.
- Checks: `cd app && npm run typecheck && npm run test:logic && npm run test:island`.

**`apps/macos/` (Swift) is legacy.** Do not build features there; see `apps/macos/LEGACY.md`. Also legacy: the old
WPF shell `apps/windows/`.

## Trying a desktop change: run from source, never package

- `cd app && npm run dev` in the branch's checkout: builds in about a second, launches the app from source and
  relaunches it on every save (`npm run start` once, without watching). Pass a dashboard with
  `npm run dev -- --dashboard=http://localhost:8080`. Tell Dani the exact checkout and command.
- Only one Vocify runs at a time (single-instance lock): quit the installed Vocify first, and test one branch at a time.
  From source the app is still "Vocify" (it starts as `electron .`), so it has the installed app's settings and sign-in.
- Swift helpers (`app/native/mac-helper`, `app/native/mac-panel`): rebuild them only when `git diff` touches
  `app/native/`. Otherwise copy the built `dist/` folders from a checkout that has them. Never two native builds at once.
- Dashboard-only changes need no desktop build: the app loads the dashboard from the web, so restarting Vocify is enough.
- Package (`npm run dist:mac*`) only when Dani asks for an installed app: his Mac's architecture only, `--dir`, reusing
  the built helpers. Never a universal build just to test (a universal build plus a native recompile took about 20
  minutes for a JS-only island change).
- On a Mac, from source, macOS sees the app as "Electron": it asks for the microphone and call audio again, and
  Electron's own Info.plist has no `NSAudioCaptureUsageDescription`, so the call-audio tap records silence with no error.
  A change to how a Mac hears the call can't be judged from source; say so rather than reading the silence as a bug.
