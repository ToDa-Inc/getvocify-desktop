// The pieces that appear in a tab and, as the same piece, in the peek: a point's card, "Ahora", the recap, and the lines
// that say nothing is there.
import { Check } from "../icons.tsx";
import { TypingDots } from "../TypingDots.tsx";
import { nowMs } from "../useNow.ts";
import { CloseSmall, InfoIcon } from "./icons.tsx";
import { callSeconds, clockLabel, tagOf, type ShownPoint, type Todo } from "./model.ts";
import { useLive } from "./context.ts";

export function Empty({ text }: { text: string }) {
  return <div className="help-empty live-empty">{text}</div>;
}

export function OfflineLine({ since }: { since: number }) {
  const { words, now } = useLive();
  return (
    <div className="lost-line live-offline">
      <InfoIcon size={11} />
      <div>
        <div className="lost-title">{words.offlineTitle}</div>
        <div className="lost-body">{words.offlineBody(Math.max(1, Math.round((now - since) / 1000)))}</div>
      </div>
    </div>
  );
}

/** Three layers: their words (small), what to say (the one thing to read), and the source only on hover. */
export function PointCard({ point, flash, onDismiss }: { point: ShownPoint; flash: number | null; onDismiss: () => void }) {
  const { words } = useLive();
  const text = point.answer ?? point.fallback ?? "";
  const source = point.answer !== null ? point.source ?? "" : [point.gap ?? point.source, words.sayMeanwhile].filter(Boolean).join(". ");
  const tag = point.repeated ? words.repeats : tagOf(point, words);
  const decision = point.decision !== null && point.decision !== "responder" ? point.decisionNote : null;
  return (
    <div className="live-item" data-phase={point.shown} data-kind={point.kind} data-still={point.landed} title={source}>
      <div className="live-item-fold">
        <div className="live-item-body">
          {flash !== null && <span key={flash} className="type-note-pulse live-card-pulse" aria-hidden />}
          <div className="live-item-head">
            {!point.draft && <span className="live-tag" data-kind={point.kind}>{tag}</span>}
            <span className="live-item-title">{point.title}</span>
            {!point.draft && <button type="button" className="live-close live-dismiss" title={words.dismiss.help} aria-label={words.dismiss.label} onClick={onDismiss}>
              <CloseSmall />
            </button>}
          </div>
          {point.shown === "thinking" ? (
            <div className="help-drafting"><span className="dim">{words.reading}</span><TypingDots /></div>
          ) : (
            <>
              {decision && <div className="live-decision">{decision}</div>}
              {point.answer === null && (
                <div className="live-gap">
                  <InfoIcon size={10} />
                  <span>{words.gap}</span>
                </div>
              )}
              <div className="help-say live-say">
                {text}
                {point.shown === "writing" && <span className="live-caret" />}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/** The one thing to do now and what to say, with its tick. The same piece in Conversación and over any tab. */
export function NowCard({ now, onTick }: { now: Todo; onTick: () => void }) {
  const { words } = useLive();
  return (
    <div className="live-now" title={now.hint}>
      <div className="live-now-head">
        <span className="live-now-lead">{words.now}</span>
        <span className="live-now-label">{now.kind === "data" ? words.find(now.label) : now.label}</span>
        <button type="button" className="live-close" title={words.tick} aria-label={words.tick} onClick={onTick}>
          <Check size={8} stroke={3.4} />
        </button>
      </div>
      <div className="live-now-say">«{now.ask}»</div>
    </div>
  );
}

/** What was said up to the moment it was asked for: a still picture, asked again to bring it up to date. */
export function RecapCard() {
  const { words, ui, update, state } = useLive();
  const recap = ui.recap?.state === "ready" ? ui.recap : null;
  return (
    <div className="live-item live-ask" data-phase="ready">
      <div className="live-item-fold">
        <div className="live-item-body">
          <div className="live-item-head">
            <span className="live-tag" data-kind="ask">{words.recapTitle(clockLabel(recap?.upTo ?? callSeconds(state.clock, nowMs())))}</span>
            <div className="grow" />
            <button type="button" className="live-close" title={words.close} aria-label={words.close} onClick={() => update({ recap: null, peek: null })}>
              <CloseSmall />
            </button>
          </div>
          {!recap ? (
            <div className="help-drafting"><span className="dim">{words.recapReading}</span><TypingDots /></div>
          ) : recap.lines.length === 0 ? (
            <span className="dim">{words.recapEmpty}</span>
          ) : (
            <ul className="live-recap">
              {recap.lines.slice(-4).map((line, i) => (
                <li key={line} style={{ animationDelay: `${i * 60}ms` }}>{line}</li>
              ))}
              {recap.unknown.length > 0 && (
                <li className="live-recap-pending" style={{ animationDelay: `${Math.min(recap.lines.length, 4) * 60}ms` }}>{words.recapUnknown(recap.unknown)}</li>
              )}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
