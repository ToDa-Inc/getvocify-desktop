import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { cornerRadius, earWidth, islandSize } from "./geometry.ts";
import { elapsedSeconds, fadedLevel, formatElapsed, helpText, turnParts } from "./helpers.ts";
import { AlertCircle, ArrowDown, ArrowUpRight, Check, ChevronDown, Close, Pause, Play, Sparkle, Waveform } from "./icons.tsx";
import type { Assist, IslandAction, IslandState, Turn, TypeMenuRow, TypeMenuView } from "./types.ts";

type Act = (action: IslandAction) => void;

/** `now` in ms; tests pin it so screenshots are repeatable. */
function useNow(intervalMs: number, active: boolean): number {
  const fixed = (window as unknown as { __fixedNow?: number }).__fixedNow;
  const [now, setNow] = useState(() => fixed ?? Date.now());
  useEffect(() => {
    if (!active || fixed !== undefined) return;
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs, active, fixed]);
  return fixed ?? now;
}

export function Island({ state, act }: { state: IslandState; act: Act }) {
  const kind = state.mode.kind;
  const open = state.expanded && kind !== "starting";
  const size = islandSize(state.geometry, kind, open);
  const radius = cornerRadius(kind, open);
  const [hovered, setHovered] = useState(false);
  const lifted = hovered && !open && kind !== "starting";
  const ear = earWidth(kind, open);
  const bar = state.geometry.barHeight;
  const isCall = kind === "call" || kind === "postCall";

  const style = {
    width: size.width,
    height: size.height,
    "--bar": `${bar}px`,
    "--radius": `${radius}px`,
  } as CSSProperties;

  return (
    <div
      className="island"
      style={style}
      data-open={open}
      data-mode={kind}
      data-material={state.material}
      data-reduce-motion={state.reduceMotion}
      onMouseEnter={() => {
        setHovered(true);
        act({ name: "pointer", inside: true });
      }}
      onMouseLeave={() => {
        setHovered(false);
        act({ name: "pointer", inside: false });
      }}
    >
      <Background open={open} />
      <div className="column">
        <div
          className="topbar"
          style={{ height: bar, padding: open ? "0 6px" : 0 }}
          title={helpText({ kind, open, stage: state.postCall?.stage ?? null, crmName: state.postCall?.crmName ?? null, pending: state.postCall?.pending ?? 0 })}
          onClick={() => act({ name: "toggle" })}
        >
          <div className="ear ear-left" style={{ width: ear, paddingLeft: !open && kind !== "recording" ? 12 : 14 }}>
            <LeftEar state={state} open={open} lifted={lifted} />
          </div>
          <div style={{ minWidth: state.geometry.notchWidth, flex: 1 }} />
          <div className="ear ear-right" style={{ width: ear, paddingRight: !open && isCall ? 10 : 12 }}>
            <RightEar state={state} open={open} lifted={lifted} act={act} />
          </div>
        </div>
        {open && <Body state={state} act={act} />}
      </div>
      {open && state.countdown && <CountdownLine countdown={state.countdown} />}
      <Rim lifted={lifted} open={open} />
    </div>
  );
}

function Background({ open }: { open: boolean }) {
  return (
    <div className="bg" aria-hidden>
      <div className="bg-tint" />
      <div className="bg-sheen" />
      <div className="bg-strip" />
      <div className="bg-strip-fade" style={{ height: open ? 16 : 0 }} />
    </div>
  );
}

function Rim({ lifted, open }: { lifted: boolean; open: boolean }) {
  return (
    <div className="rim" style={{ opacity: open ? 1 : lifted ? 0.35 : 0 }} aria-hidden>
      <div className="rim-glow" />
      <div className="rim-line" />
    </div>
  );
}

function CountdownLine({ countdown }: { countdown: NonNullable<IslandState["countdown"]> }) {
  const now = useNow(33, countdown.runningSince !== null);
  const left = countdown.remaining - (countdown.runningSince === null ? 0 : (now - countdown.runningSince) / 1000);
  const fraction = Math.max(0, Math.min(1, left / countdown.total));
  return (
    <div className="countdown" aria-hidden>
      <div className="countdown-bar" style={{ width: `${fraction * 100}%` }} />
    </div>
  );
}

function LeftEar({ state, open, lifted }: { state: IslandState; open: boolean; lifted: boolean }) {
  const mode = state.mode;
  switch (mode.kind) {
    case "recording":
      return (
        <div className="row gap6">
          <RecordingDot paused={state.paused} reduceMotion={state.reduceMotion} />
          <Elapsed state={state} />
        </div>
      );
    case "stopped":
      return (
        <div className="row gap6">
          <RecordingDot paused reduceMotion={state.reduceMotion} />
          <Elapsed state={state} />
        </div>
      );
    case "call":
      return <CallerIcon caller={mode.caller} />;
    case "starting":
      return <Spinner />;
    case "idle":
      return <VocifyMark style={{ opacity: lifted || open ? 1 : 0.85 }} />;
    case "postCall": {
      if (open) return <VocifyMark />;
      const stage = state.postCall?.stage;
      if (stage === "writing" || stage === "applying") return <Spinner />;
      if (stage === "done") return <Check size={11} stroke={3.4} style={{ color: "var(--beige)" }} />;
      return <VocifyMark />;
    }
  }
}

function RightEar({ state, open, lifted, act }: { state: IslandState; open: boolean; lifted: boolean; act: Act }) {
  const mode = state.mode;
  switch (mode.kind) {
    case "recording":
      return (
        <div className="row gap7">
          {state.paused ? (
            <span className="paused">Paused</span>
          ) : (
            <>
              {state.callAudioLost && (
                <span title="Not hearing the call: only your mic is recording" aria-label="Can't hear the call" className="warn-icon">
                  <AlertCircle size={12} />
                </span>
              )}
              {state.assist !== null && !open && (
                <span title="Live help is ready" className="help-ready">
                  <Sparkle size={10} />
                </span>
              )}
              <VoiceWave state={state} />
            </>
          )}
          <OpenArrow open={open} />
        </div>
      );
    case "call":
      return open ? (
        <OpenArrow open />
      ) : (
        <RecordDot
          ready={state.recorderReady}
          title={state.recorderReady ? (mode.caller.name ? `Record this ${mode.caller.name} call` : "Record this call") : "Sign in to record"}
          onClick={() => act({ name: "record" })}
        />
      );
    case "stopped":
      return null;
    case "starting":
      return <span className="starting">Starting</span>;
    case "idle":
      return <OpenArrow open={open} style={{ opacity: lifted || open ? 1 : 0.8 }} />;
    case "postCall":
      if (open) return <OpenArrow open />;
      return state.postCall && state.postCall.pending > 0 ? <PendingBadge count={state.postCall.pending} /> : null;
  }
}

function Body({ state, act }: { state: IslandState; act: Act }) {
  const mode = state.mode;
  switch (mode.kind) {
    case "recording":
      return <OpenIsland state={state} act={act} />;
    case "call":
      return <CallMenu state={state} caller={mode.caller} act={act} />;
    case "stopped":
      return <StoppedMenu title={mode.title} act={act} />;
    case "postCall":
      // The after-call card is not ported yet; it lands in the next slice of this branch.
      return null;
    default:
      return <IdleMenu ready={state.recorderReady} act={act} />;
  }
}

/* ---------- menus ---------- */

function IdleMenu({ ready, act }: { ready: boolean; act: Act }) {
  return (
    <div className="menu">
      <QuietRecordButton title="Record meeting" ready={ready} onClick={() => act({ name: "record" })} />
      <div className="grow" />
      <IconButton help="Open Vocify" onClick={() => act({ name: "openApp" })}>
        <ArrowUpRight size={12} />
      </IconButton>
    </div>
  );
}

function CallMenu({ state, caller, act }: { state: IslandState; caller: { name: string | null }; act: Act }) {
  const label = state.callContact ?? (caller.name ? `${caller.name} call` : "Call in progress");
  return (
    <div className="menu">
      <span className="menu-title" data-dim={state.callContact === null}>{label}</span>
      <div className="grow" />
      <QuietRecordButton title="Record" ready={state.recorderReady} onClick={() => act({ name: "record" })} />
      <IconButton help="Skip this call" onClick={() => act({ name: "dismissCall" })}>
        <Close size={11} />
      </IconButton>
    </div>
  );
}

function StoppedMenu({ title, act }: { title: string; act: Act }) {
  return (
    <div className="menu">
      <span className="menu-title">{title}</span>
      <div className="grow" />
      <PrimaryActionButton title="Resume" help="Keep recording this call" onClick={() => act({ name: "resume" })}>
        <Play size={9} />
      </PrimaryActionButton>
    </div>
  );
}

/* ---------- open recording ---------- */

function OpenIsland({ state, act }: { state: IslandState; act: Act }) {
  const [typeOpen, setTypeOpen] = useState(false);
  const menu = state.typeMenu;
  return (
    <div className="open-island">
      <div className="controls">
        <CircleButton
          help={state.paused ? "Resume recording" : "Pause recording"}
          onClick={() => act({ name: "togglePause" })}
        >
          {state.paused ? <Play size={10} /> : <Pause size={10} />}
        </CircleButton>
        <StopButton onClick={() => act({ name: "stop" })} />
        {menu && (
          <button
            type="button"
            className="type-tag-button"
            title={menu.sparkle ? "Vocify's proposal for this call. Change it if it's another kind." : "The call type: live help uses its playbook"}
            onClick={() => setTypeOpen((value) => !value)}
          >
            <TypeTag menu={menu} />
          </button>
        )}
        <div className="grow" />
        {state.liveHelp !== null && <LiveHelpToggle on={state.liveHelp} onClick={() => act({ name: "toggleLiveHelp" })} />}
        <IconButton help="Open Vocify" onClick={() => act({ name: "openApp" })}>
          <ArrowUpRight size={12} />
        </IconButton>
      </div>
      {typeOpen && menu && (
        <div className="type-list-wrap">
          <TypeList
            rows={menu.rows}
            choose={(key) => {
              act({ name: "pickCallType", key });
              setTypeOpen(false);
            }}
          />
        </div>
      )}
      {state.callAudioLost && !state.paused && <CallAudioLostLine />}
      {state.liveHelp !== false && <HelpSection current={state.assist} earlier={state.lastHelp} />}
      <div className="hairline" />
      <TranscriptScroll turns={state.turns} />
    </div>
  );
}

function CallAudioLostLine() {
  return (
    <div className="lost-line">
      <AlertCircle size={11} style={{ color: "var(--warning)", marginTop: 2 }} />
      <div>
        <div className="lost-title">Not hearing the call</div>
        <div className="lost-body">Only your mic is recording. Check the call's sound plays on this computer.</div>
      </div>
    </div>
  );
}

function HelpSection({ current, earlier }: { current: Assist | null; earlier: Assist | null }) {
  const shown = current ?? earlier;
  const retired = current === null;
  const heading = !shown ? "Live help" : retired ? "Earlier" : shown.label || "Live help";
  return (
    <div className="help" style={{ opacity: retired && shown ? 0.55 : 1 }}>
      <div className="help-heading" data-retired={retired}>
        <Sparkle size={9} style={{ opacity: retired ? 0.5 : 1 }} />
        <span>{heading}</span>
      </div>
      {shown ? (
        <>
          {shown.bridge !== "" && <div className="help-bridge">“{shown.bridge}”</div>}
          {shown.drafting ? (
            <div className="help-drafting">
              {shown.bridge === "" && <span className="dim">Preparing a reply</span>}
              <TypingDots />
            </div>
          ) : (
            shown.sayThis !== "" && <div className="help-say">{shown.sayThis}</div>
          )}
        </>
      ) : (
        <div className="help-empty">Answers show up here when they ask or push back.</div>
      )}
    </div>
  );
}

const FOLLOW_SLACK = 120;

function TranscriptScroll({ turns }: { turns: Turn[] }) {
  const ref = useRef<HTMLDivElement>(null);
  const followingRef = useRef(true);
  const [following, setFollowing] = useState(true);

  const jump = useCallback(() => {
    const el = ref.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, []);

  const onScroll = () => {
    const el = ref.current;
    if (!el) return;
    // Growth alone never counts as scrolling away: only the distance from the bottom does.
    const next = el.scrollHeight - el.scrollTop - el.clientHeight <= FOLLOW_SLACK;
    if (next !== followingRef.current) {
      followingRef.current = next;
      setFollowing(next);
    }
  };

  useLayoutEffect(() => {
    if (followingRef.current) jump();
  }, [turns, jump]);

  // The viewport shrinks when the type list opens and the content grows as words stream in:
  // either way, a reader who is at the latest line stays there (the Swift view anchors to the bottom).
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new ResizeObserver(() => {
      if (followingRef.current) jump();
    });
    observer.observe(el);
    if (el.firstElementChild) observer.observe(el.firstElementChild);
    return () => observer.disconnect();
  }, [jump]);

  return (
    <div className="transcript-wrap">
      <div className="transcript" ref={ref} onScroll={onScroll}>
        <div>
          {turns.length === 0 && <div className="listening">Listening…</div>}
          <div className="bubbles">
            {turns.map((turn) => (
              <TurnBubble key={turn.id} turn={turn} />
            ))}
          </div>
          <div style={{ height: 12 }} />
        </div>
      </div>
      {!following && (
        <button
          type="button"
          className="latest"
          title="Jump to the latest line"
          onClick={() => {
            followingRef.current = true;
            setFollowing(true);
            jump();
          }}
        >
          <ArrowDown size={10} />
          <span>Latest</span>
        </button>
      )}
    </div>
  );
}

function TurnBubble({ turn }: { turn: Turn }) {
  const parts = turnParts(turn);
  const phase = Math.floor(useNow(350, parts.dots) / 350) % 3;
  const lead = parts.text === "" && parts.tail === "" ? "" : " ";
  return (
    <div className="turn" data-you={turn.you}>
      {!turn.you && turn.label && <div className="turn-label">{turn.label}</div>}
      <div className="bubble" data-you={turn.you}>
        <span className="words">{parts.text}</span>
        {parts.tail !== "" && <span className="dim">{(parts.joined ? "" : " ") + parts.tail}</span>}
        {parts.dots && (
          <>
            {lead}
            {[0, 1, 2].map((dot) => (
              <span key={dot} className="dim" style={{ opacity: dot === phase ? 1 : 0.35 }}>•</span>
            ))}
          </>
        )}
      </div>
    </div>
  );
}

/* ---------- small pieces ---------- */

function Elapsed({ state }: { state: IslandState }) {
  const running = state.clock !== null && state.clock.pausedAt === null;
  const now = useNow(250, running);
  return <span className="elapsed">{formatElapsed(elapsedSeconds(state.clock, now))}</span>;
}

const REST = [3, 4.5, 6, 4.5, 3];

function VoiceWave({ state }: { state: IslandState }) {
  const now = useNow(42, !state.reduceMotion);
  const you = fadedLevel(state.levels, "you", now);
  const them = fadedLevel(state.levels, "them", now);
  const level = Math.min(1, Math.max(you, them) * 1.4);
  const t = now / 1000;
  return (
    <div className="wave" title="Beige is you speaking, white is them" aria-label="Voice activity" style={{ opacity: 0.45 + 0.55 * Math.min(1, level / 0.15) }}>
      {REST.map((rest, index) => {
        const wave = state.reduceMotion ? 1 : 0.55 + 0.45 * Math.sin(t * 9 + index * 1.2);
        return (
          <span
            key={index}
            style={{
              height: rest + 10 * level * wave,
              background: state.levels.side === "you" ? "var(--beige)" : "rgba(255,255,255,.85)",
            }}
          />
        );
      })}
    </div>
  );
}

function RecordingDot({ paused, reduceMotion }: { paused: boolean; reduceMotion: boolean }) {
  return (
    <span
      className="rec-dot"
      data-paused={paused}
      data-pulse={!paused && !reduceMotion}
      aria-label={paused ? "Paused" : "Recording"}
    />
  );
}

function CallerIcon({ caller }: { caller: { name: string | null; icon?: string | null } }) {
  return (
    <span title={caller.name ? `${caller.name} is using the mic` : "A call is using the mic"} className="row">
      {caller.icon ? <img src={caller.icon} width={18} height={18} alt="" /> : <Waveform size={12} style={{ color: "var(--text)" }} />}
    </span>
  );
}

function VocifyMark({ style }: { style?: CSSProperties }) {
  return <img className="mark" src="./icon.png" width={16} height={16} alt="Vocify" style={style} />;
}

function Spinner() {
  return <span className="spinner" aria-label="Working" />;
}

function OpenArrow({ open, style }: { open: boolean; style?: CSSProperties }) {
  return (
    <span className="open-arrow" style={style} aria-label={open ? "Close" : "Open"}>
      <ChevronDown size={9} stroke={3.4} style={{ transform: `rotate(${open ? 180 : 0}deg)` }} />
    </span>
  );
}

function PendingBadge({ count }: { count: number }) {
  return <span className="badge">{count}</span>;
}

function TypingDots() {
  const now = useNow(33, true);
  const t = now / 1000;
  return (
    <span className="dots" aria-label="Writing">
      {[0, 1, 2].map((index) => (
        <span key={index} style={{ opacity: 0.35 + 0.65 * Math.max(0, Math.sin(t * 4 - index * 0.7)) }} />
      ))}
    </span>
  );
}

function QuietRecordButton({ title, ready, onClick }: { title: string; ready: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      className="quiet-record"
      title={ready ? "Records your mic as You and the call as Them" : "Opens Vocify to sign in"}
      onClick={(event) => {
        event.stopPropagation();
        onClick();
      }}
    >
      {ready && <span className="red-dot" />}
      <span>{ready ? title : "Sign in to record"}</span>
    </button>
  );
}

function RecordDot({ ready, title, onClick }: { ready: boolean; title: string; onClick: () => void }) {
  return (
    <button
      type="button"
      className="record-dot"
      title={title}
      aria-label="Record"
      onClick={(event) => {
        event.stopPropagation();
        onClick();
      }}
    >
      <span style={{ background: ready ? "var(--danger)" : "var(--secondary)" }} />
    </button>
  );
}

function IconButton({ help, onClick, children }: { help: string; onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" className="icon-button" title={help} aria-label={help} onClick={(event) => { event.stopPropagation(); onClick(); }}>
      {children}
    </button>
  );
}

function CircleButton({ help, onClick, children }: { help: string; onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" className="circle-button" title={help} aria-label={help} onClick={onClick}>
      {children}
    </button>
  );
}

function StopButton({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" className="stop-button" title="Stop recording" aria-label="Stop recording" onClick={onClick}>
      <span className="stop-square" />
      <span>Stop</span>
    </button>
  );
}

function PrimaryActionButton({ title, help, onClick, children }: { title: string; help: string; onClick: () => void; children?: ReactNode }) {
  return (
    <button type="button" className="primary-action" title={help} onClick={onClick}>
      {children}
      <span>{title}</span>
    </button>
  );
}

function LiveHelpToggle({ on, onClick }: { on: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      className="live-help-toggle"
      data-on={on}
      role="switch"
      aria-checked={on}
      aria-label="Live help"
      title={on ? "Live help is on for this call" : "Live help is off for this call"}
      onClick={onClick}
    >
      <Sparkle size={9.5} />
      <span className="switch"><span className="knob" /></span>
    </button>
  );
}

function TypeTag({ menu }: { menu: TypeMenuView }) {
  return (
    <span className="type-tag" data-placeholder={menu.placeholder}>
      {menu.sparkle && <Sparkle size={8.5} style={{ color: "var(--beige)" }} />}
      <span className="type-tag-label">{menu.title}</span>
      <ChevronDown size={7} stroke={3.6} />
    </span>
  );
}

function TypeList({ rows, choose }: { rows: TypeMenuRow[]; choose: (key: string | null) => void }) {
  return (
    <div className="type-list">
      {rows.map((row) => (
        <button type="button" key={row.label} className="type-row" aria-selected={row.checked} onClick={() => choose(row.key)}>
          <span className="type-check" style={{ opacity: row.checked ? 1 : 0 }}><Check size={9.5} stroke={3.4} /></span>
          <span className="type-row-label" data-decide={row.key === null}>{row.label}</span>
          {row.suggested && <Sparkle size={9} style={{ color: "var(--beige)" }} />}
        </button>
      ))}
    </div>
  );
}
