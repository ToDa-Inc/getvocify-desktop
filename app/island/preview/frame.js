// Dev-only: renders one fixture (?fixture=name) so the island can be reviewed in any browser.
const params = new URLSearchParams(location.search);
const fixture = window.__FIXTURES.find((f) => f.name === params.get("fixture"));
window.__fixedNow = window.__NOW;
const wait = () => new Promise((resolve) => (function poll() { window.__setIslandState ? resolve() : setTimeout(poll, 10); })());
wait().then(() => {
  window.__setIslandState(fixture.state);
  setTimeout(() => {
    for (const selector of fixture.steps ?? []) document.querySelector(selector)?.click();
  }, 50);
});
