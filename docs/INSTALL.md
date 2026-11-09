# Install Vocify for Mac

Vocify for Mac (macOS 14.2 or later, Apple Silicon and Intel) is the Electron app in [`app/`](../app/). Builds are
signed with the team's own **Vocify Dev** certificate, not an Apple Developer ID, so macOS asks once before the first
launch. After that the app updates itself.

## Option A: one command (no macOS warning)

Open **Terminal** and paste:

```bash
curl -fsSL https://raw.githubusercontent.com/ToDa-Inc/getvocify-desktop/main/scripts/install-mac.sh | bash
```

It downloads the newest build, checks it is signed with the Vocify Dev certificate, puts it in **Applications** and
opens it. Run the same command again to reinstall. Quit Vocify first (menu bar icon → Quit Vocify) if it is open.

## Option B: download the DMG

1. Open [Releases](https://github.com/ToDa-Inc/getvocify-desktop/releases) and download `Vocify-<version>-universal.dmg`
   from the newest release.
2. Open the DMG and drag **Vocify** to **Applications**.
3. Double-click Vocify. macOS says it can't verify the app: click **Done**.
4. Open **System Settings → Privacy & Security**, scroll to **Security**, click **Open Anyway** next to Vocify, and
   confirm with your password or Touch ID.

You do this once. Vocify then opens normally, updates included.

## First run

1. Sign in with your Vocify account.
2. Allow **Microphone**, and **Screen & System Audio Recording** when Vocify asks (to hear the other side of the call).
3. Quit Vocify (menu bar icon → Quit Vocify) and open it again once after allowing system audio: macOS needs it.

## Updates

Vocify checks for a new version when it starts and every 30 minutes, downloads it in the background and restarts
into it when nothing is being recorded. To check now: **Settings → System → Updates → Check for updates**, or
**Check for updates** in the menu bar icon.

## Building locally (developers)

See [BUILD-AND-RELEASE.md](BUILD-AND-RELEASE.md).
