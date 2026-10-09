import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type MouseEvent, type ReactNode, type RefObject } from "react";
import { cornerRadius, earWidth, islandSize, offerBriefLines, showsMeeting } from "./geometry.ts";
import { levelsStore } from "./levels.ts";
import { elapsedSeconds, fadedLevel, finishLine, formatElapsed, helpText, transcriptText, turnParts, turnPlainText } from "./helpers.ts";
import { AlertCircle, ArrowDown, ArrowUpRight, Building, Calendar, Check, CheckCircle, ChevronDown, Close, Copy, ExclamationCircle, FileText, Keypad, Mail, Mic, MicSlash, Pause, Phone, PhoneDown, PhoneOutline, Play, Sparkle, Video, Waveform } from "./icons.tsx";
import { briefWhen, CallWording, PhoneFormat, type BriefKind, type BriefLine, type CompanyBrief, type DialIslandState, type OnScreenBrief, type OnScreenCall } from "../../core/callIsland.ts";
import { MeetingWording, type IslandMeeting } from "../../core/meetingHeadsUp.ts";
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
  // As tall as its content: the after-call card, and a call offer or call carrying the contact's brief (it wraps).
  const natural = open && (kind === "postCall" || offerBriefLines(state) > 0);
  const shape = islandSize(state.geometry, kind, open, undefined, offerBriefLines(state), showsMeeting(state));
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
      data-natural={natural}
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
      ) : state.crmBlocked && !open ? (
        <BlockedGlyph browser={state.crmBlocked.browser} onClick={() => act({ name: "toggle" })} />
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
      return state.onScreen ? <DialConfirmMenu onScreen={state.onScreen} ready={state.recorderReady} act={act} /> : <IdleMenu ready={state.recorderReady} onScreen={null} act={act} />;
    case "dialing":
      return state.dial ? <DialingMenu dial={state.dial} act={act} /> : null;
    default:
      return <IdleMenu ready={state.recorderReady} onScreen={state.onScreen} meeting={state.meeting} crmBlocked={state.crmBlocked} act={act} />;
  }
}

/* ---------- menus ---------- */

/** An offer's row (a call, or a meeting about to start) and, under a hairline, what happened with them lately. */
function Offer({ brief, children }: { brief: OnScreenBrief | null | undefined; children: ReactNode }) {
  if (!brief) return <div className="menu">{children}</div>;
  return (
    <div className="offer">
      <div className="menu offer-row">{children}</div>
      <div className="offer-brief">
        {brief.state === "loading" ? (
          <>
            <div className="recent-label">Recent activity</div>
            <RecentLoading />
          </>
        ) : (
          <BriefBody lines={brief.lines} company={brief.company ?? null} />
        )}
      </div>
    </div>
  );
}

/** Two quiet bars while the summary is read (the words are for screen readers). */
function RecentLoading() {
  return (
    <div className="recent-loading" aria-live="polite">
      <span className="sr-only">Reading recent activity</span>
      <span className="recent-bar" />
      <span className="recent-bar" style={{ width: "62%" }} />
    </div>
  );
}

/** The contact's recent activity, then what others at its company said; either can be missing. */
function BriefBody({ lines, company, labelled = true }: { lines: BriefLine[]; company: CompanyBrief | null; labelled?: boolean }) {
  return (
    <>
      {lines.length > 0 && (
        <>
          {labelled && <div className="recent-label">Recent activity</div>}
          <RecentLines lines={lines} />
        </>
      )}
      {company && <CompanySection company={company} />}
    </>
  );
}

/** Every line in full: what it is about, the line (after who it was with, for the company's), and when; a line
 * without a kind or date shows the text alone. */
function RecentLines({ lines }: { lines: BriefLine[] }) {
  return (
    <div className="recent-lines" aria-live="polite">
      {lines.map((line) => (
        <RecentRow key={`${line.who ?? ""}${line.text}`} type={line.type} at={line.at} who={line.who ?? null} text={line.text} />
      ))}
    </div>
  );
}

function RecentRow({ type, at, who, text, className }: { type: BriefKind | null; at: string | null; who: string | null; text: string | null; className?: string }) {
  const now = new Date(useNow(60_000, true));
  const when = briefWhen({ type, at }, now);
  return (
    <div className={className ? `recent-line ${className}` : "recent-line"}>
      <span className="recent-icon" title={type ? BRIEF_KIND_LABEL[type] : undefined}>
        {type && <BriefKindIcon kind={type} />}
      </span>
      <span className="recent-text">
        {who && <span className="recent-who">{who}</span>}
        {who && text && <span className="recent-sep"> · </span>}
        {text}
      </span>
      {when && <span className="recent-when">{when}</span>}
    </div>
  );
}

/**
 * What was already said with other people at the contact's company, so the rep does not pitch from scratch. At rest
 * one row says who was last in touch and when (always visible: that is the warning); the summary's lines on what
 * they discussed open on request.
 */
function CompanySection({ company }: { company: CompanyBrief }) {
  const [open, setOpen] = useState(false);
  const key = `${company.name}|${company.latest?.who}|${company.latest?.at}|${company.lines.map((line) => line.text).join("|")}`;
  // Another contact's company starts folded.
  useEffect(() => setOpen(false), [key]);
  const canOpen = company.lines.length > 0;
  const others = company.people - (company.latest?.who ? 1 : 0);
  const latestWho = company.latest?.who ?? "Filed on the company";
  const label = company.name ? `Others at ${company.name}` : "Others at the company";
  return (
    <div className="company-brief">
      {canOpen ? (
        <button
          type="button"
          className="recent-label company-toggle"
          aria-expanded={open}
          title={open ? "Show less" : "What they discussed"}
          onClick={(event) => {
            event.stopPropagation();
            setOpen((was) => !was);
          }}
        >
          <span>{label}</span>
          <ChevronDown size={8} style={{ transform: open ? "none" : "rotate(-90deg)", transition: "transform 150ms" }} />
        </button>
      ) : (
        <div className="recent-label">{label}</div>
      )}
      {open ? (
        <RecentLines lines={company.lines} />
      ) : (
        <RecentRow
          className="company-latest"
          type={company.latest?.type ?? null}
          at={company.latest?.at ?? null}
          who={null}
          text={others > 0 ? `${latestWho} and ${others} ${others === 1 ? "other" : "others"}` : latestWho}
        />
      )}
    </div>
  );
}

const BRIEF_KIND_LABEL: Record<BriefKind, string> = {
  call: "Call",
  email: "Email",
  note: "Note",
  meeting: "Meeting",
  task: "Task",
  vocify_conversation: "Vocify conversation",
  company: "Company",
};

function BriefKindIcon({ kind }: { kind: BriefKind }) {
  switch (kind) {
    case "call":
      return <PhoneOutline size={11} />;
    case "email":
      return <Mail size={11} />;
    case "note":
      return <FileText size={11} />;
    case "meeting":
      return <Calendar size={11} />;
    case "task":
      return <CheckCircle size={11} />;
    case "vocify_conversation":
      return <Waveform size={11} />;
    case "company":
      return <Building size={11} />;
  }
}

/**
 * During the call: what happened with the contact before. In full while nobody has spoken yet (there is nothing else
 * to read); once the conversation starts it folds to one line above it, so the call has the space, and opens on request.
 */
function BeforeThisCall({ lines, company, talking }: { lines: BriefLine[]; company: CompanyBrief | null; talking: boolean }) {
  // The rep's own choice wins over the automatic fold, for the rest of the call.
  const [picked, setPicked] = useState<boolean | null>(null);
  const open = picked ?? !talking;
  const latest = lines[0]?.text ?? company?.latest?.who ?? null;
  const more = lines.length + (company ? 1 : 0) - 1;
  return (
    <div className="before-call" data-open={open}>
      <button
        type="button"
        className="recent-label before-call-toggle"
        aria-expanded={open}
        title={open ? "Show less" : "What happened before this call"}
        onClick={(event) => {
          event.stopPropagation();
          setPicked(!open);
        }}
      >
        <ChevronDown size={8} style={{ transform: open ? "none" : "rotate(-90deg)", transition: "transform 150ms" }} />
        <span>Before this call</span>
        {!open && latest && <span className="before-call-latest">{latest}</span>}
        {!open && more > 0 && <span className="before-call-more">+{more}</span>}
      </button>
      <div className="before-call-fold" aria-hidden={!open}>
        <div className="before-call-body">
          <BriefBody lines={lines} company={company} labelled={false} />
        </div>
      </div>
    </div>
  );
}

function IdleMenu({
  ready,
  onScreen,
  meeting,
  crmBlocked,
  act,
}: {
  ready: boolean;
  onScreen: OnScreenCall | null;
  meeting?: IslandMeeting | null;
  crmBlocked?: IslandState["crmBlocked"];
  act: Act;
}) {
  if (meeting) return <MeetingSoonMenu meeting={meeting} ready={ready} act={act} />;
  if (!onScreen && crmBlocked) return <CrmBlockedMenu browser={crmBlocked.browser} act={act} />;
  return (
    <Offer brief={onScreen?.brief}>
      {onScreen ? (
        <>
          <OnScreenOffer onScreen={onScreen} act={act} />
          <QuietRecordButton title="Record" ready={ready} besideCall onClick={() => act({ name: "record" })} />
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
    </Offer>
  );
}

/** A meeting about to start (from the calendar): who it is with, its title, when and where, and what
 * happened with them lately; Join opens the call, Record starts the recording. Same as MeetingSoonMenu in MeetingPill.swift. */
function MeetingSoonMenu({ meeting, ready, act }: { meeting: IslandMeeting; ready: boolean; act: Act }) {
  const now = useNow(15_000, true);
  return (
    <Offer brief={meeting.brief}>
      <div className="menu-stack">
        <MeetingWho who={meeting.who} />
        {/* A long title gives way ("…", in full on hover); when and where always show in full. */}
        <span className="menu-line meeting-line">
          {meeting.title && (
            <span className="meeting-title" title={meeting.title}>
              {meeting.title}
            </span>
          )}
          <span className="meeting-place">{MeetingWording.place(meeting, now)}</span>
        </span>
      </div>
      <div className="grow" />
      {meeting.url && (
        <PrimaryActionButton title="Join" help="Open the meeting" onClick={() => act({ name: "joinMeeting" })}>
          <Video size={10} />
        </PrimaryActionButton>
      )}
      <QuietRecordButton title="Record" ready={ready} besideCall onClick={() => act({ name: "record" })} />
      <IconButton help="Dismiss" onClick={() => act({ name: "dismissMeeting" })}>
        <Close size={11} />
      </IconButton>
    </Offer>
  );
}

/** "Marta García +2": a long name gives way ("…", in full on hover), the "+2" always shows. */
function MeetingWho({ who }: { who: string }) {
  const [, name, more] = /^(.*?)(\s\+\d+)?$/.exec(who) ?? [who, who, undefined];
  return (
    <span className="menu-title meeting-who" title={who}>
      <span className="meeting-who-name">{name}</span>
      {more && <span className="meeting-who-more">{more}</span>}
    </span>
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
/** Where the call icon would be: macOS won't let Vocify read the browser in front, so it can't offer a call. */
function BlockedGlyph({ browser, onClick }: { browser: string; onClick: () => void }) {
  const help = `Vocify can't see your ${browser} tabs`;
  return (
    <button
      type="button"
      className="call-glyph blocked-glyph"
      title={help}
      aria-label={help}
      onClick={(event) => {
        event.stopPropagation();
        onClick();
      }}
    >
      <ExclamationCircle size={11} />
    </button>
  );
}

/** Why there is no call offer, and Fix: the dashboard shows how to allow it (one click to the right Settings page). */
function CrmBlockedMenu({ browser, act }: { browser: string; act: Act }) {
  return (
    <div className="menu">
      <div className="menu-stack">
        <span className="menu-title">Vocify can't see your {browser} tabs</span>
        <span className="menu-line">Allow it to call the contact you have open</span>
      </div>
      <div className="grow" />
      <PrimaryActionButton title="Fix" help="Open Vocify to allow it" onClick={() => act({ name: "fixCrmAccess" })}>
        <ArrowUpRight size={9} />
      </PrimaryActionButton>
    </div>
  );
}

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
function DialConfirmMenu({ onScreen, ready, act }: { onScreen: OnScreenCall; ready: boolean; act: Act }) {
  // Closing is the bar's chevron, as everywhere else on the island.
  return (
    <Offer brief={onScreen.brief}>
      <OnScreenOffer onScreen={onScreen} act={act} />
      <QuietRecordButton title="Record" ready={ready} besideCall onClick={() => act({ name: "record" })} />
    </Offer>
  );
}

/** Connecting or ringing: who, and Cancel. Missed: why it ended. Answered, the island is the recording's (see `OpenIsland`). */
function DialingMenu({ dial, act }: { dial: DialIslandState; act: Act }) {
  const ended = dial.phase === "ended";
  const row = (
    <>
      <span className="menu-title" data-dim={ended}>{ended ? CallWording.ended(dial) : CallWording.dialing(dial)}</span>
      <div className="grow" />
      {!ended && <HangUpButton title="Cancel" onClick={() => act({ name: "hangup" })} />}
    </>
  );
  // While it connects or rings, what happened with the contact lately stays under "Calling…".
  if (ended || (!dial.brief && !dial.companyBrief)) return <div className="menu">{row}</div>;
  return (
    <div className="offer">
      <div className="menu offer-row">{row}</div>
      <div className="offer-brief">
        <BriefBody lines={dial.brief ?? []} company={dial.companyBrief} />
      </div>
    </div>
  );
}

/** An answered Vocify call: mute, keypad, hang up (in place of Pause and Stop). */
function CallBar({ dial, keypadOpen, keypadButton, act }: { dial: DialIslandState; keypadOpen: boolean; keypadButton: RefObject<HTMLButtonElement | null>; act: Act }) {
  return (
    <>
      <CircleButton help={dial.muted ? "Unmute" : "Mute"} onClick={() => act({ name: "toggleMute" })}>
        {dial.muted ? <MicSlash size={11} /> : <Mic size={11} />}
      </CircleButton>
      <CircleButton
        help={keypadOpen ? "Hide keypad" : "Keypad"}
        active={keypadOpen}
        buttonRef={keypadButton}
        onClick={(event) => {
          event.stopPropagation();
          act({ name: "keypad", open: !keypadOpen });
        }}
      >
        <Keypad size={10} />
      </CircleButton>
      <HangUpButton title="Hang up" onClick={() => act({ name: "hangup" })} />
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
/** How many tapped keys the display keeps (the newest). */
const KEYPAD_SHOWN = 12;

/** Digits for phone menus (press 1 for sales…), sent as the call's tones. It floats over the call under its button,
 * so the conversation keeps its place; the display shows what was tapped, since the tones themselves are silent here. */
function KeypadPopover({ anchor, onDigit, onClose }: { anchor: Anchor; onDigit: (digit: string) => void; onClose: () => void }) {
  const [tapped, setTapped] = useState("");
  return (
    <FloatMenu anchor={anchor} width={160} maxHeight={240} role="group" onClose={onClose} label="Keypad">
      <div className="dial-display" aria-live="polite">{tapped}</div>
      <div className="dial-pad">
        {KEYPAD_ROWS.flat().map((digit) => (
          <button
            key={digit}
            type="button"
            className="dial-key"
            aria-label={digit}
            onClick={() => {
              setTapped((so) => (so + digit).slice(-KEYPAD_SHOWN));
              onDigit(digit);
            }}
          >
            {digit}
          </button>
        ))}
      </div>
    </FloatMenu>
  );
}

/* ---------- open recording ---------- */

function OpenIsland({ state, act }: { state: IslandState; act: Act }) {
  const [typeAnchor, setTypeAnchor] = useState<Anchor | null>(null);
  const closeType = useCallback(() => setTypeAnchor(null), []);
  const keypadButton = useRef<HTMLButtonElement>(null);
  const [keypadAnchor, setKeypadAnchor] = useState<Anchor | null>(null);
  // The keypad opens under its own button, wherever the open state came from.
  useLayoutEffect(() => {
    setKeypadAnchor(state.keypadOpen && keypadButton.current ? anchorOf(keypadButton.current) : null);
  }, [state.keypadOpen]);
  const closeKeypad = useCallback(() => act({ name: "keypad", open: false }), [act]);
  const menu = state.typeMenu;
  const hasBrief = Boolean(state.dial?.brief?.length || state.dial?.companyBrief);
  return (
    <div className="open-island">
      <div className="controls">
        {state.dial ? (
          <CallBar dial={state.dial} keypadOpen={state.keypadOpen} keypadButton={keypadButton} act={act} />
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
            title={
              menu.proposed
                ? "Vocify chose this from the conversation. Pick another if it's wrong."
                : menu.channel
                  ? "The call or meeting, and its type: live help uses its playbook"
                  : "The call type: live help uses its playbook"
            }
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
        {state.turns.length > 0 && <CopyButton text={transcriptText(state.turns)} help="Copy the transcript" />}
        {state.liveHelp !== null && <LiveHelpToggle on={state.liveHelp} onClick={() => act({ name: "toggleLiveHelp" })} />}
        <IconButton help="Open Vocify" onClick={() => act({ name: "openApp" })}>
          <ArrowUpRight size={12} />
        </IconButton>
      </div>
      {typeAnchor && menu && (
        <FloatMenu anchor={typeAnchor} width={190} onClose={closeType} label="Call type">
          {menu.channel && (
            <>
              {menu.channel.rows.map((row) => (
                <MenuRow
                  key={row.key}
                  label={row.label}
                  selected={row.checked}
                  onPick={() => {
                    // The menu stays open: switching the channel changes the types listed under it.
                    if (!row.checked) act({ name: "pickChannel", kind: row.key });
                  }}
                />
              ))}
              <div className="hairline menu-divider" />
            </>
          )}
          {menu.rows.map((row) => (
            <MenuRow
              key={row.key}
              label={row.label}
              selected={row.checked}
              onPick={() => {
                act({ name: "pickCallType", key: row.key });
                setTypeAnchor(null);
              }}
            />
          ))}
        </FloatMenu>
      )}
      {state.keypadOpen && state.dial?.phase === "active" && keypadAnchor && (
        <KeypadPopover anchor={keypadAnchor} onDigit={(digit) => act({ name: "digit", digit })} onClose={closeKeypad} />
      )}
      {state.callAudioLost && !state.paused && <CallAudioLostLine />}
      {state.liveHelp !== false && <HelpSection current={state.assist} earlier={state.lastHelp} />}
      <div className="hairline" />
      {hasBrief && state.dial && <BeforeThisCall lines={state.dial.brief ?? []} company={state.dial.companyBrief ?? null} talking={state.turns.length > 0} />}
      <TranscriptScroll turns={state.turns} reduceMotion={state.reduceMotion} />
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
/** The glide covers what is left to the latest line on this time constant (ms): it lands in about a fifth of a second. */
const GLIDE_MS = 60;
/** A glide that got no frames (a window the system stopped painting) still ends at the latest line by then. */
const GLIDE_LIMIT_MS = 400;

/**
 * The conversation, kept at its latest line while the rep is reading there. New words make the view glide down
 * instead of snapping a line at a time, and only the rep's own scrolling (wheel, scrollbar) lets go of the latest line:
 * the view's own movement never does.
 */
function TranscriptScroll({ turns, reduceMotion }: { turns: Turn[]; reduceMotion: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const followingRef = useRef(true);
  const [following, setFollowing] = useState(true);
  const glide = useRef<{ frame: number; limit: ReturnType<typeof setTimeout> } | null>(null);
  // Turns already there when the transcript opens just show; the ones that arrive after it come in.
  const opened = useRef(false);
  useEffect(() => {
    opened.current = true;
  }, []);

  const stopGlide = useCallback(() => {
    if (!glide.current) return;
    cancelAnimationFrame(glide.current.frame);
    clearTimeout(glide.current.limit);
    glide.current = null;
  }, []);

  const jump = useCallback(() => {
    stopGlide();
    const el = ref.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [stopGlide]);

  /** To the latest line: gliding when it is near and frames are running, at once otherwise (tests pin the clock). */
  const follow = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const left = () => el.scrollHeight - el.clientHeight - el.scrollTop;
    const still = reduceMotion || window.__fixedNow !== undefined || document.visibilityState !== "visible";
    if (still || left() > el.clientHeight) return jump();
    // A glide already under way just has further to go: its limit starts again with the new words.
    if (glide.current) {
      clearTimeout(glide.current.limit);
      glide.current.limit = setTimeout(jump, GLIDE_LIMIT_MS);
      return;
    }
    if (left() < 1) return;
    let last = performance.now();
    // The position is kept here: the element rounds what it is given, and a glide that read it back would stall.
    let at = el.scrollTop;
    const step = (now: number) => {
      const current = glide.current;
      if (!current) return;
      const rest = el.scrollHeight - el.clientHeight - at;
      if (rest < 0.5) return jump();
      at += rest * (1 - Math.exp(-(now - last) / GLIDE_MS));
      last = now;
      // Whole pixels only: text drawn between two pixels is redrawn blurred on every step.
      el.scrollTop = Math.round(at);
      current.frame = requestAnimationFrame(step);
    };
    glide.current = { frame: requestAnimationFrame(step), limit: setTimeout(jump, GLIDE_LIMIT_MS) };
  }, [jump, reduceMotion]);

  const onScroll = () => {
    const el = ref.current;
    // The glide's own movement says nothing about where the rep wants to read.
    if (!el || glide.current) return;
    const next = el.scrollHeight - el.scrollTop - el.clientHeight <= FOLLOW_SLACK;
    if (next !== followingRef.current) {
      followingRef.current = next;
      setFollowing(next);
    }
  };

  /** The rep took the scroll (wheel up, or the scrollbar): the view stops moving under them. */
  const letGo = () => {
    stopGlide();
    onScroll();
  };

  useLayoutEffect(() => {
    if (followingRef.current) follow();
  }, [turns, follow]);

  // The viewport shrinks when the type list opens and the content grows as words stream in:
  // either way, a reader who is at the latest line stays there (the Swift view anchors to the bottom).
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new ResizeObserver(() => {
      if (followingRef.current) follow();
    });
    observer.observe(el);
    if (el.firstElementChild) observer.observe(el.firstElementChild);
    return () => {
      observer.disconnect();
      stopGlide();
    };
  }, [follow, stopGlide]);

  return (
    <div className="transcript-wrap">
      <div
        className="transcript"
        ref={ref}
        onScroll={onScroll}
        onWheel={(event) => {
          if (event.deltaY < 0) letGo();
        }}
        onPointerDown={(event) => {
          if (event.target === ref.current) letGo();
        }}
      >
        <div>
          {turns.length === 0 && <div className="listening">Listening…</div>}
          <div className="bubbles">
            {turns.map((turn) => (
              <TurnBubble key={turn.id} turn={turn} arrives={opened.current && !reduceMotion} />
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

/** The island never takes the keyboard, so the shortcut cannot copy from it: text goes to the clipboard on request. */
async function copyText(text: string): Promise<boolean> {
  try {
    if (window.vocifyIsland?.copy) return await window.vocifyIsland.copy(text);
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/** A button that copies `text` and says so for a moment (a check, and its help text). */
function CopyButton({ text, help, className }: { text: string; help: string; className?: string }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1300);
    return () => clearTimeout(timer);
  }, [copied]);
  return (
    <IconButton
      help={copied ? "Copied" : help}
      className={className ? `copy-button ${className}` : "copy-button"}
      onClick={() => void copyText(text).then((ok) => ok && setCopied(true))}
    >
      {copied ? <Check size={11} stroke={2.6} /> : <Copy size={11} />}
    </IconButton>
  );
}

/**
 * One turn. While its words are still arriving the bubble only ever grows: the live transcription rewrites its last
 * words several times a second, and a bubble that followed every rewrite would shrink and stretch under the reader.
 * It takes its real size again once the turn has settled.
 */
function TurnBubble({ turn, arrives }: { turn: Turn; arrives: boolean }) {
  const parts = turnParts(turn);
  const bubble = useRef<HTMLDivElement>(null);
  const floor = useRef({ width: 0, height: 0 });
  // Decided once, when the bubble is first drawn: a later update never plays the entrance again.
  const [entering] = useState(arrives);
  useLayoutEffect(() => {
    const el = bubble.current;
    if (!el) return;
    el.style.minWidth = "";
    el.style.minHeight = "";
    if (!parts.dots) {
      floor.current = { width: 0, height: 0 };
      return;
    }
    const box = el.getBoundingClientRect();
    floor.current = { width: Math.max(floor.current.width, box.width), height: Math.max(floor.current.height, box.height) };
    el.style.minWidth = `${floor.current.width}px`;
    el.style.minHeight = `${floor.current.height}px`;
  }, [parts.text, parts.tail, parts.dots]);
  return (
    <div className="turn" data-you={turn.you} data-entering={entering}>
      {!turn.you && turn.label && <div className="turn-label">{turn.label}</div>}
      <div className="bubble-row" data-you={turn.you}>
        <div className="bubble" ref={bubble} data-you={turn.you}>
          <span className="words">{parts.text}</span>
          {parts.tail !== "" && <span className="dim">{(parts.joined ? "" : " ") + parts.tail}</span>}
          {/* Held to the last word (no-break space), so the dots never drop to a line of their own. */}
          {parts.dots && (
            <span className="live-dots" aria-hidden>
              {"\u00a0"}
              <i />
              <i />
              <i />
            </span>
          )}
        </div>
        {turnPlainText(turn) !== "" && <CopyButton text={turnPlainText(turn)} help="Copy" className="turn-copy" />}
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

/** `besideCall`: next to Call, as tall as it and quieter, so Call stays the main action. */
function QuietRecordButton({ title, ready, besideCall = false, onClick }: { title: string; ready: boolean; besideCall?: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      className="quiet-record"
      data-beside-call={besideCall}
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

function IconButton({ help, onClick, children, className }: { help: string; onClick: () => void; children: ReactNode; className?: string }) {
  return (
    <button type="button" className={className ? `icon-button ${className}` : "icon-button"} title={help} aria-label={help} onClick={(event) => { event.stopPropagation(); onClick(); }}>
      {children}
    </button>
  );
}

function CircleButton({ help, active, buttonRef, onClick, children }: { help: string; active?: boolean; buttonRef?: RefObject<HTMLButtonElement | null>; onClick: (event: MouseEvent<HTMLButtonElement>) => void; children: ReactNode }) {
  return (
    <button type="button" ref={buttonRef} className="circle-button" data-active={active} title={help} aria-label={help} aria-pressed={active} onClick={onClick}>
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
      {menu.channel && (
        <>
          <span className="type-tag-channel">{menu.channel.title}</span>
          <span aria-hidden>·</span>
        </>
      )}
      <span className="type-tag-label">{menu.title}</span>
      <ChevronDown size={7} stroke={3.6} />
    </span>
  );
}

