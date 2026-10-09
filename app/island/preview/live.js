// Dev-only: a call as it streams (live.html), to judge the transcript's motion in any browser. Words arrive a few at a
// time, the last ones get rewritten, each sentence settles, and the two sides take turns, as the live transcription does.
// ?speed=2 plays it twice as fast; window.__LIVE counts what moved (see `watch`).
const base = window.__FIXTURES.find((f) => f.name === "in-call-brief").state;
const speed = Number(new URLSearchParams(location.search).get("speed")) || 1;
const SCRIPT = [
  [true, "Hola Dani, ¿qué tal? ¿Cómo estás?"],
  [false, "Eh, bien. Sí."],
  [true, "Muy bien. Soy Toni, fundador de Vocify. Te llamo porque vi que tenéis seis comerciales usando Salesforce y quería enseñarte cómo quitarles el trabajo de actualizar el CRM después de cada llamada."],
  [false, "Vale, pero ahora mismo no queremos cambiar de herramienta, no vemos el momento."],
  [true, "Tiene sentido, el momento importa. No hace falta cambiar nada: Vocify escribe en vuestro Salesforce. ¿Te llamo el jueves a las diez o prefieres otro día?"],
  [false, "El jueves me va bien. Mándame una invitación y lo vemos con el equipo de operaciones, que son los que más lo sufren."],
  [true, "Perfecto, te la mando ahora."],
];
// ?script=rally: quick back-and-forth, short turns with almost no gap, each answer starting before the question has settled.
const RALLY = [
  [true, "¿Cuántos sois en ventas?"], [false, "Somos seis comerciales."], [true, "¿Y qué CRM usáis?"], [false, "Salesforce."],
  [true, "¿Contentos con él?"], [false, "Regular, la verdad."], [true, "¿Por qué?"], [false, "Nadie lo actualiza después de las llamadas."],
  [true, "Vale."], [false, "Y luego el forecast no cuadra."], [true, "¿Cada cuánto lo revisáis?"], [false, "Los lunes."],
];
const rally = new URLSearchParams(location.search).get("script") === "rally";
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms / speed));
const turns = [];
// ?material=opaque: as on Windows (no blur behind the window).
const material = new URLSearchParams(location.search).get("material") === "opaque" ? "opaque" : "vibrancy";
const push = () => window.__setIslandState({ ...base, material, reduceMotion: false, turns: turns.map((turn) => ({ ...turn })) });

/**
 * What a reader would see move, counted from the layout itself (not from frames, so a slow page counts the same):
 * `shrinks`: times a bubble got smaller while its words were still arriving; `dotsAlone`: times the dots sat on a line
 * of their own; `maxStep`: the biggest single move of the view (px); `maxBehind`: how far it ever sat from the latest
 * line; `unfollowed`: times "Latest" showed although nobody scrolled.
 */
function watch() {
  const live = (window.__LIVE = { shrinks: 0, dotsAlone: 0, maxStep: 0, maxBehind: 0, unfollowed: 0, layouts: 0 });
  const sizes = new WeakMap();
  const arriving = (bubble) => Boolean(bubble.querySelector(".live-dots")) || bubble.textContent.includes("\u2022");
  const check = () => {
    live.layouts += 1;
    for (const bubble of document.querySelectorAll(".bubble")) {
      const box = bubble.getBoundingClientRect();
      const was = sizes.get(bubble);
      if (was && was.arriving && arriving(bubble) && (box.width < was.width - 0.5 || box.height < was.height - 0.5)) live.shrinks += 1;
      sizes.set(bubble, { width: box.width, height: box.height, arriving: arriving(bubble) });
      const dots = bubble.querySelector(".live-dots") ?? [...bubble.querySelectorAll("span")].find((span) => span.textContent === "\u2022");
      const words = bubble.querySelector(".dim") ?? bubble.querySelector(".words");
      if (dots && words) {
        const lines = words.getClientRects();
        const lastLine = lines[lines.length - 1];
        if (lastLine && dots.getClientRects()[0] && dots.getClientRects()[0].top > lastLine.top + 4) live.dotsAlone += 1;
      }
    }
    const t = document.querySelector(".transcript");
    if (t) live.maxBehind = Math.max(live.maxBehind, Math.round(t.scrollHeight - t.clientHeight - t.scrollTop));
    if (document.querySelector(".latest")) live.unfollowed += 1;
  };
  new MutationObserver(() => requestAnimationFrame(check)).observe(document.getElementById("root"), { subtree: true, childList: true, characterData: true });
  let lastTop = null;
  document.addEventListener("scroll", (event) => {
    const t = event.target;
    if (!(t instanceof Element) || !t.classList.contains("transcript")) return;
    if (lastTop !== null) live.maxStep = Math.max(live.maxStep, Math.round(Math.abs(t.scrollTop - lastTop)));
    lastTop = t.scrollTop;
  }, true);
}

async function say(you, text, id) {
  const turn = { id, you, label: you ? null : "Dani test", text: "", pending: "" };
  turns.push(turn);
  for (const sentence of text.match(/[^.?!]+[.?!]+\s*/g) ?? [text]) {
    const words = sentence.trim().split(" ");
    for (let shown = 1; shown <= words.length; shown += 1 + (shown % 3 === 0 ? 1 : 0)) {
      const heard = words.slice(0, shown).join(" ").toLowerCase().replace(/[¿?¡!.,:]/g, "");
      // The last word is often misheard first, then corrected: longer, then shorter.
      turn.pending = shown % 4 === 2 ? `${heard}mente y` : heard;
      // A test can hold the call still to look at what is on screen (window.__livePause).
      while (window.__livePause) await new Promise((resolve) => setTimeout(resolve, 30));
      push();
      await sleep(150);
    }
    // In a rally the words settle a moment later, while the other side is already answering.
    const settle = () => {
      turn.pending = "";
      turn.text = turn.text ? `${turn.text} ${sentence.trim()}` : sentence.trim();
      push();
    };
    if (rally) setTimeout(settle, 260 / speed);
    else {
      settle();
      await sleep(220);
    }
  }
}

(async () => {
  while (!window.__setIslandState) await sleep(10);
  window.__setIslandState({ ...base, material, reduceMotion: false, turns: [] });
  watch();
  await sleep(1500);
  for (let round = 0; round < 3; round += 1) {
    for (const [index, [you, text]] of (rally ? RALLY : SCRIPT).entries()) {
      await say(you, text, `r${round}-${index}`);
      await sleep(rally ? 60 : 350);
    }
  }
  await sleep(600);
  window.__LIVE.bubbles = document.querySelectorAll(".bubble").length;
  // Anything still animating inside the conversation once it is over (a bubble kept on its own layer, a pulsing dot).
  window.__LIVE.stillAnimating = document.querySelector(".transcript").getAnimations({ subtree: true }).length;
  window.__LIVE.done = true;
})();
