# Branch and worktree cleanup: inventory and proposed plan

Written 2026-10-05. **Nothing in this file has been executed.** Everything below was read with read-only git commands
after `git fetch`. "Contained" means every commit's patch already exists on the named remote branch (checked with `git cherry`).
"Local-only" means the commit is on no remote at all, so deleting its branch would lose it.

## 1. What is at risk (exists only on this Mac)

| Item | Where | Why it matters |
|---|---|---|
| Uncommitted change to `MeetingPill.swift` (the island remembers "signed in" across launches) | `~/getvocify-desktop`, branch `feat/live-speed-report` | Not on any branch or remote. Likely another session's work; confirm owner |
| 1 local-only commit `b6ae913b` "backup: local staging working tree before merging feat/home-dashboard" | dashboard branch `backup/staging-wip-before-home-merge`, no upstream | Only copy of that backup |
| 2 stashes (34 files and 18 files changed) from old `main` | dashboard repo | Only copy. Old, but never reviewed |
| 11 modified files plus untracked `src/assets/` and `video-projects/` (396 MB) | `~/getvocify` working tree, on `staging` 70 commits behind origin | Backend "hoy" confirmations, meeting proposal review, calendar settings, product catalog. Unknown owner; not on any branch |
| 2 modified files (`auth/context.tsx`, `DesktopMeetingProvider.tsx`) | `~/getvocify-auth-fix`, branch `fix/island-auth-state` | Uncommitted island auth work |

Everything else, including all other local branches in both repos, is already on a remote.

## 2. Desktop repo (`~/getvocify-desktop`)

| Branch | State | Proposed |
|---|---|---|
| `feat/call-type-live-help`, `feat/live-help-turn`, `feat/live-speed-report`, `fix/island-clarity` | All fully contained in `origin/integrate/island` | Delete locally after the uncommitted change above is saved |
| `integrate/island` | Local is 1 commit behind origin (the help-card commit) | Fast-forward. This is the active line |
| `main` | Local is 1 commit behind origin (`9ac4e98`, CI change). A push to `main` is a release | Fast-forward only; never push casually |
| `test_account.md` | Untracked, 0 bytes, not gitignored | Add to `.gitignore` so credentials can never be committed by accident |
| `docs/WINDOWS-PLAN.md`, this file | Untracked | Commit on the new Electron branch |
| Worktree in `/private/tmp/.../scratchpad/desk` on `feat/live-help-turn` | Belongs to another session | Leave it; remove only after that session ends |

Target state: `main`, `integrate/island`, and one new branch cut from `origin/integrate/island` for Electron.

## 3. Dashboard repo (`~/getvocify`)

Remote branches are not touched in this plan. Deleting remote branches is outward-facing and is Dani's call.

**Safe to delete locally, 0 unique commits (all patches already in `origin/staging`):**
`chore/desktop-into-staging`, `dashboard-dani-version`, `feat/call-type-live-help`, `feat/desktop-call-flow`,
`feat/desktop-call-flow-staging`, `feat/desktop-recorder-staging`, `feat/home-dashboard`, `feat/live-call-contact`,
`feat/live-help-turn`, `fix/admin-sees-calling-usage`, `fix/island-clarity`.

**Keep for now:**
| Branch | Reason |
|---|---|
| `integrate/island` | Active line, ahead of staging |
| `fix/island-auth-state` | Dirty worktree (2 files). Its commits are in staging; the uncommitted files are not |
| `backup/staging-wip-before-home-merge` | Local-only commit. Push it as a backup or export it before any deletion |
| `feat/desktop-meeting-recorder` | CI and `build-app.sh` still pin to it (stale since 2026-09-28). Repoint to `staging` or a commit SHA first, then delete |
| `staging`, `main` | Long-lived. Local `staging` is 70 behind: fast-forward after the dirty tree is dealt with |

**Delete after a quick check:** `backup/recorder-wip-2026-10-01` (10 commits, but the same branch exists on `origin`, so
the remote copy is the backup); `fix/pipedrive-contact-company-fields` (patches are in `origin/main`; confirm its PR merged).

**Stashes:** export each as a patch file (or `git stash branch`) into an archive folder before dropping. Do not drop unseen.

**Worktrees:** 11 extra worktrees (about 28 MB each). After their branches are gone, `git worktree remove` each.
Keep `~/.vocify-build/dashboard`, the build script's cache. Leave scratchpad worktrees of other sessions.

**`~/getvocify` working tree:** its owner must say whether the 11 files are wanted. Per the pairing note, never commit
or merge inside that tree; preserve the changes by copying them to a separate worktree on a `wip/` branch, push it, then
reset the main tree to `origin/staging`.

## 4. Disk (1.5 GiB free of 228 GiB right now)

| Item | Size | Safe? |
|---|---|---|
| `~/getvocify/.reticle/sessions` | 1.6 GB | Tool session recordings, regenerable. Ask first |
| `~/.npm` cache | 1.0 GB | Regenerable |
| `~/getvocify/remotion`, `video-projects` | 660 MB, 396 MB | `video-projects` is untracked user data: do not delete without asking |
| `apps/macos/.build` | 610 MB | Rebuildable, but needed for fast Swift builds |

## 5. Order of operations

1. Free the regenerable disk (reticle sessions, npm cache). Needs approval.
2. Preserve everything in section 1: commit the island change to a branch and push; push or bundle the backup commit;
   export the stashes; park the `~/getvocify` working-tree changes on a `wip/` branch after the owner confirms.
3. Fast-forward `main` and `integrate/island`. Delete the merged local branches and their worktrees.
4. Cut `feat/electron` from `origin/integrate/island` in a clean worktree.
5. Repoint CI and `build-app.sh` from the stale dashboard branch to `staging` or a SHA.

Re-run the "local-only commits" check (`git rev-list --count <branch> --not --remotes`) before and after; it must
report nothing lost.
