// Dev-only checks that run in any browser: size, overflow, scroll and click behaviour for every fixture.
// Open preview.html?check=1; the result lands in window.__CHECK and in #result.
(async () => {
  if (!new URLSearchParams(location.search).get("check")) return;
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const load = async (fixture) => {
    const frame = document.createElement("iframe");
    frame.width = Math.max(520, fixture.expect.width + 60);
    frame.height = fixture.expect.height + 40;
    frame.src = `frame.html?fixture=${fixture.name}`;
    document.body.appendChild(frame);
    await new Promise((resolve) => (frame.onload = resolve));
    await sleep(160);
    return frame;
  };
  const failures = [];
  const skipped = [];
  const report = [];
  // A hidden page runs no animation frames, so ResizeObserver never fires: layout-follow checks cannot be judged there.
  const hidden = document.visibilityState !== "visible";

  for (const fixture of window.__FIXTURES) {
    const frame = await load(fixture);
    const win = frame.contentWindow;
    const doc = frame.contentDocument;
    const el = doc.querySelector(".island");
    const problems = [];
    if (!el) problems.push("island did not render");
    else {
      const r = el.getBoundingClientRect();
      const got = { width: Math.round(r.width), height: Math.round(r.height) };
      if (got.width !== fixture.expect.width || got.height !== fixture.expect.height) {
        problems.push(`size ${got.width}x${got.height}, expected ${fixture.expect.width}x${fixture.expect.height}`);
      }
      if (!(r.left >= 0 && r.right <= win.innerWidth && r.bottom <= win.innerHeight)) problems.push("island outside its window");
      const overflow = [...doc.querySelectorAll(".ear, .menu, .controls, .help, .lost-line")]
        .filter((e) => e.scrollWidth > e.clientWidth + 1)
        .map((e) => `${e.className} ${e.scrollWidth}>${e.clientWidth}`);
      if (overflow.length) problems.push(`content wider than its box: ${overflow.join("; ")}`);
      const t = doc.querySelector(".transcript");
      if (t && t.scrollHeight - t.scrollTop - t.clientHeight >= 2) {
        if (hidden && fixture.steps?.length) skipped.push(`${fixture.name}: transcript pinned to latest line after a resize (page hidden, no frames)`);
        else problems.push("transcript not scrolled to the latest line");
      }
      if (t) {
        const clipped = [...doc.querySelectorAll(".bubble")].map((b) => b.getBoundingClientRect()).filter((b) => b.left < r.left - 0.5 || b.right > r.right + 0.5).length;
        if (clipped) problems.push(`${clipped} bubble(s) cut off at the island edge`);
      }
      const topbar = doc.querySelector(".topbar").getBoundingClientRect();
      if (Math.abs(topbar.height - fixture.state.geometry.barHeight) > 0.5) problems.push(`top bar ${topbar.height}px, expected ${fixture.state.geometry.barHeight}px`);
    }
    report.push({ name: fixture.name, problems });
    if (problems.length) failures.push(`${fixture.name}: ${problems.join("; ")}`);
    frame.remove();
  }

  for (const test of window.__INTERACTIONS) {
    const fixture = window.__FIXTURES.find((f) => f.name === test.fixture);
    const frame = await load(fixture);
    const win = frame.contentWindow;
    const doc = frame.contentDocument;
    win.__islandActions.length = 0;
    const target = doc.querySelector(test.click);
    let problem = null;
    if (!target) problem = `no element for ${test.click}`;
    else {
      target.click();
      await sleep(40);
      const actions = JSON.parse(JSON.stringify(win.__islandActions));
      if (JSON.stringify(actions) !== JSON.stringify(test.expect)) problem = `sent ${JSON.stringify(actions)}, expected ${JSON.stringify(test.expect)}`;
    }
    report.push({ name: `click:${test.name}`, problems: problem ? [problem] : [] });
    if (problem) failures.push(`click:${test.name}: ${problem}`);
    frame.remove();
  }

  window.__CHECK = { total: report.length, passed: report.length - failures.length, failures, skipped, report };
  const out = document.createElement("pre");
  out.id = "result";
  out.textContent = `island: ${window.__CHECK.passed}/${window.__CHECK.total} checks passed, ${skipped.length} skipped\n` + failures.map((f) => `FAIL ${f}`).join("\n") + skipped.map((f) => `SKIPPED ${f}`).join("\n");
  document.body.prepend(out);
  document.title = "check done";
})();
