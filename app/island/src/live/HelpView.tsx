// Ayuda: react to what they said. One unit, the point; one ask, Responder (in the bar).
import { ChevronDown } from "../icons.tsx";
import { Empty, OfflineLine, PointCard } from "./cards.tsx";
import { useLive } from "./context.ts";
import { FollowScroll } from "./FollowScroll.tsx";
import { tagOf } from "./model.ts";

export function HelpView() {
  const { live, ui, update, points, words, liveHelp, still, act } = useLive();
  if (!liveHelp) return <Empty text={words.helpOff} />;
  const open = points.filter((p) => p.shown !== "closed");
  const earlier = points.filter((p) => p.shown === "closed");
  // Two points open in full at most, the newest; older open ones wait as one line each.
  const full = new Set(open.filter((p) => p.shown !== "closing").slice(-2).map((p) => p.id));
  const unanswered = earlier.filter((p) => p.outcome === "unanswered").length;
  const dismiss = (id: string) => {
    update({ dismissed: [...ui.dismissed, id], reopened: ui.reopened.filter((r) => r !== id) });
    act({ name: "liveDismiss", id });
  };
  return (
    <div className="live-help">
      {live.offlineSince !== null && <OfflineLine since={live.offlineSince} />}
      <FollowScroll follow still={still}>
        <div className="live-help-list">
          {earlier.length > 0 && (
            <div className="live-earlier" data-open={ui.earlierOpen}>
              <button type="button" className="live-section-toggle" aria-expanded={ui.earlierOpen} onClick={() => update({ earlierOpen: !ui.earlierOpen })}>
                <span>{words.before} · {earlier.length}</span>
                {unanswered > 0 && <span className="live-unanswered-count">{words.unanswered(unanswered)}</span>}
                <ChevronDown size={7} stroke={3.6} />
              </button>
              <div className="live-fold">
                <div className="live-fold-body">
                  {earlier.map((p) => (
                    <div key={p.id} className="live-earlier-row" title={p.answer ?? p.fallback ?? ""}>
                      <span className="live-earlier-tag">{tagOf(p, words)}</span>
                      <span className="live-earlier-title">{p.title}</span>
                      <span className="live-outcome" data-outcome={p.outcome}>{words.outcome[p.outcome]}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
          {open.length === 0 && earlier.length === 0 && <div className="help-empty live-help-empty">{words.helpEmpty}</div>}
          {open.map((p) =>
            full.has(p.id) || p.shown === "closing" || ui.expandedId === p.id ? (
              <PointCard key={p.id} point={p} flash={ui.flashId === p.id ? ui.flashAt : null} onDismiss={() => dismiss(p.id)} />
            ) : (
              <button key={p.id} type="button" className="live-item-line" title={words.open} onClick={() => update({ expandedId: p.id })}>
                <span className="live-tag" data-kind={p.kind}>{tagOf(p, words)}</span>
                <span className="live-item-title">{p.title}</span>
                <ChevronDown size={7} stroke={3.6} />
              </button>
            ),
          )}
        </div>
      </FollowScroll>
    </div>
  );
}
