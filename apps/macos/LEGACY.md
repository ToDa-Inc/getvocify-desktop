# Legacy: the Swift Mac app

This folder is the old native Swift app. **Vocify desktop is the Electron app in [`../../app/`](../../app/).**

- Do not add features here. New desktop and island work goes to the Electron app (`app/`, on `main`).
- It is kept only because the Mac release workflow (`.github/workflows/release-mac.yml`) still builds its DMG,
  until the Electron Mac app takes over that release. Fix it only if that release breaks.
- Its features already have Electron equivalents (same rules, ported): call detection, the island, the call offer
  and brief, the meeting heads-up, and naming who speaks (Zoom through Accessibility, Google Meet through the
  Vocify Chrome extension, in `app/native/mac-helper`).
