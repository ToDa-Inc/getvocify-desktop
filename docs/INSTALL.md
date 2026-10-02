# Install Vocify for Mac

Vocify is a native macOS app (14+) that embeds the Vocify dashboard and records meetings without a bot.

## For teammates (recommended)

### Option A — Download a build from GitHub

1. Open [Releases](https://github.com/ToDa-Inc/getvocify-desktop/releases) and download **Vocify-macos.dmg**.
   If there is no release yet, go to **Actions → Release Mac → Run workflow**, then download the **Vocify-macos** artifact from the completed run.
2. Open the DMG and drag **Vocify** to **Applications**.
3. Launch Vocify. If macOS blocks it:
   - **Notarized build:** double-click should work.
   - **Unsigned / team-signed build:** right-click **Vocify → Open**, confirm once. If you see “damaged”, run:
     ```bash
     xattr -cr /Applications/Vocify.app
     ```
4. Sign in with your Vocify account.
5. Start **Record meeting**. Allow **Microphone** and **Screen & System Audio Recording**.
6. **Quit Vocify (⌘Q) and reopen once** after granting system audio — macOS requires this.

### Option B — Build locally

Requires Xcode command-line tools, Swift 5.9+, Node 20+, and the dashboard repo cloned at `~/getvocify`.

```bash
git clone https://github.com/ToDa-Inc/getvocify-desktop.git
cd getvocify-desktop

# Stable local signature (required for system audio to persist)
bash scripts/create-dev-signing-cert.sh
CODESIGN_IDENTITY="Vocify Dev" bash apps/macos/scripts/package-dmg.sh

open dist/Vocify-macos.dmg
```

Each machine needs its own **Vocify Dev** certificate unless you share a team `.p12` through your password manager.

## First-run checklist

| Step | What happens |
|------|----------------|
| Sign in | Uses production API (`api.getvocify.com`) |
| Record meeting | Native macOS permission prompts |
| After system audio | Quit and reopen Vocify once |
| During call | Floating pill shows timer and live transcript |
| Stop | Opens memo for CRM review |

## CI / releases (maintainers)

Workflow: `.github/workflows/release-mac.yml`

| Trigger | Result |
|---------|--------|
| Push to `main` (mac app paths) | Build artifact |
| Tag `v*` | Build + GitHub Release with DMG attached |
| Manual dispatch | Same as push to main |
| Daily (05:17 UTC) | Build artifact, only if the dashboard's `staging` or this repo's `main` changed since the last build |

The dashboard is bundled from `ToDa-Inc/getvocify` at ref **`staging`**. To get the latest app: **Actions → Release Mac → Run workflow**, then download the **Vocify-macos** artifact from the run.

### Optional: notarized public distribution

Add these GitHub repository secrets for Gatekeeper-friendly installs:

| Secret | Value |
|--------|--------|
| `APPLE_CERTIFICATE_BASE64` | Base64-encoded `.p12` (Developer ID Application) |
| `APPLE_CERTIFICATE_PASSWORD` | `.p12` export password |
| `APPLE_SIGNING_IDENTITY` | Certificate name, e.g. `Developer ID Application: Vocify Inc (TEAMID)` |
| `APPLE_ID` | Apple ID email |
| `APPLE_APP_SPECIFIC_PASSWORD` | App-specific password from appleid.apple.com |
| `APPLE_TEAM_ID` | 10-character team ID |

Without these secrets, CI produces an unsigned DMG (fine for internal testing with right-click → Open).

### Cut a release

```bash
git tag v0.3.0
git push origin v0.3.0
```

The workflow attaches `dist/Vocify-macos.dmg` to the GitHub Release.
