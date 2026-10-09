# Checking the island's drawing on Windows

How the Windows transcript glitch of 9 Oct 2026 was investigated without a Windows PC, what was found, and how to run
the same checks again. Everything here was actually run; what was **not** proven is said so.

## What happened

- `0.4.209` (commit `dfe8457`) made the live transcript smooth: a bubble only grows while its words arrive, the view
  glides to the latest line, new bubbles fade in, the dots pulse.
- On Dani's Windows PC that version showed **old words left painted under new ones and black patches inside bubbles**.
  The Mac build of the same code did not.
- `0.4.210` (`f7f8c5b`) turned the glide and the animations off on Windows. The glitch was reported again on "the new
  version"; which version was installed at that moment was not checked.
- `0.4.211` (`f306302`) also stopped setting bubble sizes on Windows. Whether that removed the glitch on the PC was
  never confirmed.
- The next version (this change) turns the full smoothing back on for Windows and draws the app **in software** there
  (`app.disableHardwareAcceleration()` in `app/main/src/main.ts`, Windows only).

## What was measured, and where

Two harnesses, both playing the same scripted call (`app/island/preview/live.js`) in a real Electron window:

| Harness | What it counts | Fails when |
| --- | --- | --- |
| `app/test/motion-island.mjs` | Layout: bubbles that got smaller while words arrived, dots on a line of their own, the biggest single move of the view, "Latest" showing though nobody scrolled, anything still animating at the end | any of those is above zero |
| `app/test/paint-island.mjs` | Drawing: every ~1.3 s the call is held still, the window is captured, everything is redrawn from scratch, it is captured again, and the two pictures are compared | more than 40 pixels differ (under the top bar, whose clock moves) |

The paint check takes two captures each time: the page as the app composed it (`capturePage`) and the window as the
screen showed it (cut out of a capture of the whole screen).

Results on GitHub's `windows-latest` machine (workflow "Island paint check", runs `37950557566` and `37951605460`,
9 Oct 2026):

- 0 differing pixels in every case, page and screen: full smoothing (48–49 checks), quick back-and-forth (18 checks),
  smoothing off (48–49 checks), and full smoothing with `--nogpu` (49 checks).
- That machine reported `compositing disabled_software, raster disabled_software`: **it has no graphics card, so every
  case there was drawn in software.**

On the Mac the same check found 0 differing pixels in the page capture with hardware acceleration on (the screen
capture was not available there: it needs the screen-recording permission).

## What that does and does not prove

- **Proven:** drawn in software, the smooth transcript leaves no stale paint on Windows.
- **Not proven:** that the graphics card's drawing is what caused the glitch on the PC. It was never reproduced: there
  was no Windows machine with a graphics card to run this on. Drawing in software was chosen because it is the one
  configuration measured clean on Windows.
- **Not measured:** what drawing in software costs in CPU on Windows, in the island or in the dashboard.
  `app/test/perf-island.mjs --nogpu` exists to measure the island.

If the glitch is still there in the version that draws in software, the graphics card is not the cause, and the
previous state is commit `f306302`.

## Running the checks

Locally (any system):

```bash
cd app
node island/build.mjs --preview
npx electron test/motion-island.mjs                 # long turns
npx electron test/motion-island.mjs --script=rally  # quick back-and-forth
npx electron test/paint-island.mjs --report         # prints what it found, never fails
npx electron test/paint-island.mjs --script=rally
npx electron test/paint-island.mjs --nogpu          # hardware acceleration off
```

The paint check writes the worst pair it saw to `app/test/out-paint/` (`*-stale.png` as it was, `*-fresh.png` after the
full redraw). To watch the replay in a browser: serve `app/island/dist` and open `live.html`
(`?speed=2`, `?script=rally`, `?material=opaque`).

On a Windows machine, without owning one:

- Push a branch named `paint/<anything>`: `.github/workflows/island-paint.yml` runs the paint check on `windows-latest`
  and uploads the pictures as the `island-paint` artifact. It publishes nothing (releases come only from `main`, through
  `desktop-app.yml`).
- Or run it by hand: Actions → "Island paint check" → Run workflow.
- Read the result in the run's log: each step ends with a line like
  `island: 48 checks, worst stale paint: page 0 px, screen 0 px; compositing disabled_software, ...`.

On a real Windows PC with a graphics card (the case CI cannot cover):

- Start the installed app with `--gpu` to draw with the graphics card again and compare on that PC:
  `"%LOCALAPPDATA%\Programs\Vocify\Vocify.exe" --gpu`
- Running `npx electron test/paint-island.mjs --report` from a checkout on that PC is the check that would show whether
  the graphics card reproduces the stale paint. This has not been done.
