import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { cornerRadius, earWidth, islandSize } from "./geometry.ts";
import { levelsStore } from "./levels.ts";
import { elapsedSeconds, fadedLevel, finishLine, formatElapsed, helpText, turnParts } from "./helpers.ts";
import { AlertCircle, ArrowDown, ArrowUpRight, Check, ChevronDown, Close, Keypad, Mic, MicSlash, Pause, Phone, PhoneDown, Play, RecordCircle, Sparkle, Waveform } from "./icons.tsx";
import { CallWording, PhoneFormat, type DialIslandState, type OnScreenCall } from "../../core/callIsland.ts";
import { anchorOf, FloatMenu, MenuRow, type Anchor } from "./FloatMenu.tsx";
import { PostCallCard } from "./PostCallCard.tsx";
import { postCallCrmName, postCallPending, type Assist, type IslandAction, type IslandState, type Turn, type TypeMenuView } from "./types.ts";

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
  // The after-call card is as tall as its content, which only the page can measure (fonts differ by OS).
  const [cardHeight, setCardHeight] = useState<number | null>(null);
  // A dropdown over the card reaches past it: the window must be as tall as the dropdown, the island's shape is not.
  const [popupBottom, setPopupBottom] = useState<number | null>(null);
  const column = useRef<HTMLDivElement>(null);
  const natural = kind === "postCall" && open;
  const shape = islandSize(state.geometry, kind, open);
  const size = natural && cardHeight !== null ? { width: shape.width, height: cardHeight } : shape;
  const radius = cornerRadius(kind, open);
  const [hovered, setHovered] = useState(false);
  const lifted = hovered && !open && kind !== "starting";
  const ear = earWidth(kind, open);
  const bar = state.geometry.barHeight;
  const isCall = kind === "call" || kind === "postCall";

  // Its column has no fixed height while the card is open, so what is measured is the content itself.
  useLayoutEffect(() => {
    const el = column.current;
    if (!natural || !el) return;
    const measure = () => setCardHeight(Math.ceil(el.getBoundingClientRect().height));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [natural]);

  // The window follows the island: reported here, because only the page knows the height.
  useEffect(() => {
    if (!natural || cardHeight === null) return;
    const reported = { width: size.width, height: Math.max(cardHeight, popupBottom ?? 0) };
    if (window.vocifyIsland) window.vocifyIsland.resize(reported);
    else (window.__islandSizes ??= []).push(reported);
  }, [natural, cardHeight, popupBottom, size.width]);

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
      <div className="column" ref={column}>
        <div
          className="topbar"
          style={{ height: bar, padding: open ? "0 6px" : 0 }}
          title={helpText({ kind, open, stage: state.postCall?.stage ?? null, crmName: state.postCall ? postCallCrmName(state.postCall) : null, pending: state.postCall ? postCallPending(state.postCall) : 0, finishLine: finishLine(state.finish), dialLine: dialLine(state.dial) })}
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
        {open && <Body state={state} act={act} onPopupExtent={setPopupBottom} />}
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
  const bar = useRef<HTMLDivElement>(null);
  const running = countdown.runningSince !== null;
  const secondsLeft = countdown.remaining - (running ? (Date.now() - (countdown.runningSince as number)) / 1000 : 0);
  const fraction = Math.max(0, Math.min(1, secondsLeft / countdown.total));
  // The line runs out on its own, on the compositor: set where it is now, then let it shrink to nothing.
  useEffect(() => {
    const el = bar.current;
    if (!el) return;
    el.style.transition = "none";
    el.style.transform = `scaleX(${fraction})`;
    if (!running) return;
    void el.offsetWidth;
    el.style.transition = `transform ${Math.max(0, secondsLeft)}s linear`;
    el.style.transform = "scaleX(0)";
  }, [countdown]);
  return (
    <div className="countdown" aria-hidden>
      <div className="countdown-bar" ref={bar} />
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
    case "finishing":
      return state.finish?.step === "failed" ? <AlertCircle size={12} style={{ color: "var(--warning)" }} /> : <Spinner />;
    case "starting":
      return <Spinner />;
    case "idle":
      return <VocifyMark style={{ opacity: lifted || open ? 1 : 0.85 }} />;
    case "dialConfirm":
    case "dialing":
      return <Phone size={11} style={{ color: state.dial?.phase === "ended" ? "var(--secondary)" : "var(--beige)" }} />;
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
    case "finishing":
      return open ? <OpenArrow open /> : null;
    case "starting":
      return <span className="starting">Starting</span>;
    case "idle":
      return state.onScreen && !open ? (
        <CallGlyph onScreen={state.onScreen} onClick={() => act({ name: "openDialConfirm" })} />
      ) : (
        <OpenArrow open={open} style={{ opacity: lifted || open ? 1 : 0.8 }} />
      );
    case "dialConfirm":
      return <OpenArrow open />;
    case "dialing":
      if (open) return <OpenArrow open />;
      return state.dial?.phase !== "ended" ? <HangUpDot onClick={() => act({ name: "hangup" })} /> : null;
    case "postCall":
      if (open) return <OpenArrow open />;
      return state.postCall && postCallPending(state.postCall) > 0 ? <PendingBadge count={postCallPending(state.postCall)} /> : null;
  }
}

function Body({ state, act, onPopupExtent }: { state: IslandState; act: Act; onPopupExtent: (bottom: number | null) => void }) {
  const mode = state.mode;
  switch (mode.kind) {
    case "recording":
      return <OpenIsland state={state} act={act} />;
    case "call":
      return <CallMenu state={state} caller={mode.caller} act={act} />;
    case "stopped":
      return <StoppedMenu title={mode.title} act={act} />;
    case "finishing":
      return <FinishingMenu finish={state.finish} act={act} />;
    case "postCall":
      return state.postCall ? <PostCallCard postCall={state.postCall} act={act} onPopupExtent={onPopupExtent} /> : null;
    case "dialConfirm":
      // The rep left the record while the row was open: the island goes back to rest, not blank.
      return state.onScreen ? <DialConfirmMenu onScreen={state.onScreen} act={act} /> : <IdleMenu ready={state.recorderReady} onScreen={null} act={act} />;
    case "dialing":
      return state.dial ? <DialingMenu dial={state.dial} act={act} /> : null;
    default:
      return <IdleMenu ready={state.recorderReady} onScreen={state.onScreen} act={act} />;
  }
}

/* ---------- menus ---------- */

/** At rest, open. With a CRM contact on screen it leads with who that is and Call, the way the
 * confirm row does, and recording a meeting becomes the quiet icon beside it. */
function IdleMenu({ ready, onScreen, act }: { ready: boolean; onScreen: OnScreenCall | null; act: Act }) {
  return (
    <div className="menu">
      {onScreen ? (
        <>
          <OnScreenOffer onScreen={onScreen} act={act} />
          <IconButton help="Record meeting" onClick={() => act({ name: "record" })}>
            <RecordCircle size={12} />
          </IconButton>
        </>
      ) : (
        <>
          <QuietRecordButton title="Record meeting" ready={ready} onClick={() => act({ name: "record" })} />
          <div className="grow" />
        </>
      )}
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
      <button type="button" className="text-action" title="Keep recording this call" onClick={() => act({ name: "resume" })}>
        <Play size={10} />
        <span>Resume</span>
      </button>
      <PrimaryActionButton title="Finish" help="End the call and write its update" onClick={() => act({ name: "finish" })}>
        <Check size={9} />
      </PrimaryActionButton>
    </div>
  );
}

/** The recording ended and its memo isn't being written yet: where the call is, and when it couldn't be sent, a way to Vocify, where the meeting is kept. */
function FinishingMenu({ finish, act }: { finish: IslandState["finish"]; act: Act }) {
  return (
    <div className="menu">
      <span className="menu-title menu-title-wrap">{finishLine(finish)}</span>
      <div className="grow" />
      {finish?.step === "failed" && (
        <PrimaryActionButton title="Open Vocify" help="See the meeting in Vocify" onClick={() => act({ name: "openApp" })}>
          <ArrowUpRight size={9} />
        </PrimaryActionButton>
      )}
    </div>
  );
}

/* ---------- calling the CRM contact on screen ---------- */

function dialLine(dial: DialIslandState | null): string | undefined {
  if (!dial) return undefined;
  return dial.phase === "ended" ? CallWording.ended(dial) : CallWording.dialing(dial);
}

/** The phone beside the mark: the CRM contact on screen can be called. Dimmed when it can't; the confirm row says why. */
function CallGlyph({ onScreen, onClick }: { onScreen: OnScreenCall; onClick: () => void }) {
  const help = CallWording.glyphHelp(onScreen);
  return (
    <button
      type="button"
      className="call-glyph"
      data-callable={onScreen.state === "callable"}
      title={help}
      aria-label={help}
      onClick={(event) => {
        event.stopPropagation();
        onClick();
      }}
    >
      <Phone size={10} />
    </button>
  );
}

/** Who would be called and from which number, and Call (or what is missing). */
function OnScreenOffer({ onScreen, act }: { onScreen: OnScreenCall; act: Act }) {
  const copy = CallWording.confirm(onScreen);
  return (
    <>
      <div className="menu-stack">
        <span className="menu-title">{copy.title}</span>
        <span className="menu-line">{copy.line}</span>
      </div>
      <div className="grow" />
      {copy.button &&
        (onScreen.state === "no_caller_id" ? (
          <PrimaryActionButton title={copy.button} help="Verify a number in Vocify" onClick={() => act({ name: "openCalling" })}>
            <ArrowUpRight size={9} />
          </PrimaryActionButton>
        ) : (
          <PrimaryActionButton title={copy.button} help="Call through Vocify" onClick={() => act({ name: "dial" })}>
            <Phone size={9} />
          </PrimaryActionButton>
        ))}
    </>
  );
}

/** Who would be called and from which number; one click calls. */
function DialConfirmMenu({ onScreen, act }: { onScreen: OnScreenCall; act: Act }) {
  return (
    <div className="menu">
      <OnScreenOffer onScreen={onScreen} act={act} />
      <IconButton help="Close" onClick={() => act({ name: "toggle" })}>
        <Close size={11} />
      </IconButton>
    </div>
  );
}

/** Connecting or ringing: who, and Cancel. Missed: why it ended. Answered without a live transcript, the call bar alone. */
function DialingMenu({ dial, act }: { dial: DialIslandState; act: Act }) {
  if (dial.phase === "active") {
    return (
      <div className="menu">
        <CallBar dial={dial} keypadOpen={false} act={act} />
      </div>
    );
  }
  const ended = dial.phase === "ended";
  return (
    <div className="menu">
      <span className="menu-title" data-dim={ended}>{ended ? CallWording.ended(dial) : CallWording.dialing(dial)}</span>
      <div className="grow" />
      {!ended && <HangUpButton title="Cancel" onClick={() => act({ name: "hangup" })} />}
    </div>
  );
}

/** An answered Vocify call: mute, keypad, hang up (in place of Pause and Stop). */
function CallBar({ dial, keypadOpen, showsName = true, act }: { dial: DialIslandState; keypadOpen: boolean; showsName?: boolean; act: Act }) {
  return (
    <>
      <CircleButton help={dial.muted ? "Unmute" : "Mute"} onClick={() => act({ name: "toggleMute" })}>
        {dial.muted ? <MicSlash size={11} /> : <Mic size={11} />}
      </CircleButton>
      <CircleButton help={keypadOpen ? "Hide keypad" : "Keypad"} onClick={() => act({ name: "keypad", open: !keypadOpen })}>
        <Keypad size={10} />
      </CircleButton>
      <HangUpButton title="Hang up" onClick={() => act({ name: "hangup" })} />
      {/* Who the call is with, whatever tab the rep has moved to since. The open call names them in the
          conversation instead: this row also carries the call type and live help. */}
      {showsName && <span className="menu-title call-name" title={PhoneFormat.grouped(dial.phone)}>{dial.name ?? PhoneFormat.grouped(dial.phone)}</span>}
    </>
  );
}

function HangUpButton({ title, onClick }: { title: string; onClick: () => void }) {
  return (
    <button
      type="button"
      className="stop-button"
      title={title}
      aria-label={title}
      onClick={(event) => {
        event.stopPropagation();
        onClick();
      }}
    >
      <PhoneDown size={11} />
      <span>{title}</span>
    </button>
  );
}

/** The closed island while it rings: hang up without opening it. */
function HangUpDot({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      className="hangup-dot"
      title="Cancel the call"
      aria-label="Cancel the call"
      onClick={(event) => {
        event.stopPropagation();
        onClick();
      }}
    >
      <PhoneDown size={10} />
    </button>
  );
}

const KEYPAD_ROWS = [["1", "2", "3"], ["4", "5", "6"], ["7", "8", "9"], ["*", "0", "#"]];

/** Digits for phone menus (press 1 for sales…), sent as the call's tones. */
function KeypadGrid({ onDigit }: { onDigit: (digit: string) => void }) {
  return (
    <div className="keypad">
      {KEYPAD_ROWS.flat().map((digit) => (
        <button key={digit} type="button" className="small-action keypad-key" onClick={() => onDigit(digit)}>
          {digit}
        </button>
      ))}
    </div>
  );
}

/* ---------- open recording ---------- */

function OpenIsland({ state, act }: { state: IslandState; act: Act }) {
  const [typeAnchor, setTypeAnchor] = useState<Anchor | null>(null);
  const closeType = useCallback(() => setTypeAnchor(null), []);
  const menu = state.typeMenu;
  return (
    <div className="open-island">
      <div className="controls">
        {state.dial ? (
          <CallBar dial={state.dial} keypadOpen={state.keypadOpen} showsName={false} act={act} />
        ) : (
          <>
            <CircleButton
              help={state.paused ? "Resume recording" : "Pause recording"}
              onClick={() => act({ name: "togglePause" })}
            >
              {state.paused ? <Play size={10} /> : <Pause size={10} />}
            </CircleButton>
            <StopButton onClick={() => act({ name: "stop" })} />
          </>
        )}
        {menu && (
          <button
            type="button"
            className="type-tag-button"
            title={menu.sparkle ? "Vocify's proposal for this call. Change it if it's another kind." : "The call type: live help uses its playbook"}
            onClick={(event) => {
              event.stopPropagation();
              const target = event.currentTarget;
              setTypeAnchor((open) => (open ? null : anchorOf(target)));
            }}
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
      {typeAnchor && menu && (
        <FloatMenu anchor={typeAnchor} width={190} onClose={closeType} label="Call type">
          {menu.rows.map((row) => (
            <MenuRow
              key={row.label}
              label={row.label}
              selected={row.checked}
              suggested={row.suggested}
              dim={row.key === null}
              onPick={() => {
                act({ name: "pickCallType", key: row.key });
                setTypeAnchor(null);
              }}
            />
          ))}
        </FloatMenu>
      )}
      {state.keypadOpen && state.dial && <KeypadGrid onDigit={(digit) => act({ name: "digit", digit })} />}
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
  const clock = state.clock;
  const running = clock !== null && clock.pausedAt === null;
  const fixed = (window as unknown as { __fixedNow?: number }).__fixedNow;
  const [now, setNow] = useState(() => fixed ?? Date.now());
  // One tick per whole second of meeting time, scheduled for the boundary: no second is skipped or shown twice.
  useEffect(() => {
    if (!running || fixed !== undefined || !clock) return;
    const origin = clock.startedAt + clock.pausedMs;
    let timer: ReturnType<typeof setTimeout>;
    const schedule = () => {
      const t = Date.now();
      setNow(t);
      timer = setTimeout(schedule, 1000 - (((t - origin) % 1000) + 1000) % 1000 + 5);
    };
    schedule();
    return () => clearTimeout(timer);
  }, [running, clock?.startedAt, clock?.pausedMs, fixed]);
  return <span className="elapsed">{formatElapsed(elapsedSeconds(clock, fixed ?? now))}</span>;
}

const REST = [3, 4.5, 6, 4.5, 3];
const WAVE_FRAME_MS = 42;
const SILENT = 0.002;

function VoiceWave({ state }: { state: IslandState }) {
  const root = useRef<HTMLDivElement>(null);
  const { reduceMotion } = state;

  // Redraw on each new level, then keep going only while the fade-out has something left to show.
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const fixed = (window as unknown as { __fixedNow?: number }).__fixedNow;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const draw = () => {
      clearTimeout(timer);
      const levels = levelsStore.get();
      const now = fixed ?? Date.now();
      const you = fadedLevel(levels, "you", now);
      const them = fadedLevel(levels, "them", now);
      const level = Math.min(1, Math.max(you, them) * 1.4);
      const t = now / 1000;
      el.style.opacity = String(0.45 + 0.55 * Math.min(1, level / 0.15));
      el.dataset.side = levels.side;
      const bars = el.children;
      for (let index = 0; index < bars.length; index += 1) {
        const wave = reduceMotion ? 1 : 0.55 + 0.45 * Math.sin(t * 9 + index * 1.2);
        (bars[index] as HTMLElement).style.height = `${REST[index] + 10 * level * wave}px`;
      }
      if (level > SILENT && !reduceMotion && fixed === undefined) timer = setTimeout(draw, WAVE_FRAME_MS);
    };
    draw();
    const unsubscribe = levelsStore.subscribe(draw);
    return () => {
      unsubscribe();
      clearTimeout(timer);
    };
  }, [reduceMotion]);

  return (
    <div className="wave" ref={root} title="Beige is you speaking, white is them" aria-label="Voice activity">
      {REST.map((_, index) => (
        <span key={index} />
      ))}
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
  return (
    <span className="dots" aria-label="Writing">
      <span style={{ animationDelay: "0s" }} />
      <span style={{ animationDelay: "-0.17s" }} />
      <span style={{ animationDelay: "-0.34s" }} />
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

