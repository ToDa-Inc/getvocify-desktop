import { useEffect, useRef, useState } from "react";
import { anchorOf, FloatMenu, MenuRow, type Anchor } from "./FloatMenu.tsx";
import { keyboardNow, keyboardOver, releaseKeyboardSoon } from "./keyboard.ts";
import type { IslandAction, Turn, VoiceChoice } from "./types.ts";

/**
 * The name above a line from the other side, when the dashboard tells that side's voices apart. A click opens a small
 * list to get a voice right: name it, say it is the same person as another voice, or move this paragraph to another
 * voice (or to someone new). The dashboard holds the transcript, so the island only asks; the lines change at once.
 */

type Act = (action: IslandAction) => void;
export type VoiceMenu = { voices: VoiceChoice[]; act: Act };

type View = "root" | "rename" | "merge" | "move";

export function VoiceLabel({ turn, menu }: { turn: Turn; menu: VoiceMenu }) {
  const [anchor, setAnchor] = useState<Anchor | null>(null);
  const [view, setView] = useState<View>("root");
  const voice = turn.voice as number;
  const others = menu.voices.filter((other) => other.id !== voice);
  const starts = turn.starts ?? [];
  const close = () => {
    setAnchor(null);
    setView("root");
  };
  const send = (action: IslandAction) => {
    menu.act(action);
    close();
  };
  return (
    <>
      <button
        type="button"
        className="turn-label voice-label"
        title="Name this voice, or fix who said it"
        aria-haspopup="listbox"
        aria-expanded={anchor !== null}
        onClick={(event) => {
          // A click on the label is not a click on the island: it would close it.
          event.stopPropagation();
          setView("root");
          setAnchor((open) => (open ? null : anchorOf(event.currentTarget)));
        }}
      >
        {turn.label}
      </button>
      {anchor && (
        <FloatMenu anchor={anchor} width={view === "rename" ? 190 : 168} onClose={close} label="Voice">
          {view === "root" && (
            <>
              <MenuRow label="Rename" selected={false} onPick={() => (keyboardNow(), setView("rename"))} />
              {others.length > 0 && <MenuRow label="Same person as…" selected={false} onPick={() => setView("merge")} />}
              {starts.length > 0 && <MenuRow label="Move this to…" selected={false} onPick={() => setView("move")} />}
            </>
          )}
          {view === "rename" && <NameField initial={turn.label ?? ""} onDone={(text) => (text === null ? close() : send({ name: "voice", op: "rename", voice, text }))} />}
          {view === "merge" &&
            others.map((other) => (
              <MenuRow key={other.id} label={other.label} selected={false} onPick={() => send({ name: "voice", op: "merge", keep: other.id, drop: voice })} />
            ))}
          {view === "move" && (
            <>
              {others.map((other) => (
                <MenuRow key={other.id} label={other.label} selected={false} onPick={() => send({ name: "voice", op: "move", starts, voice: other.id })} />
              ))}
              {others.length > 0 && <div className="hairline menu-divider" />}
              <MenuRow label="Someone new" selected={false} onPick={() => send({ name: "voice", op: "move", starts, voice: null })} />
            </>
          )}
        </FloatMenu>
      )}
    </>
  );
}

/** One line to type a name in. Enter keeps it, Escape drops it; an empty name goes back to the default. */
function NameField({ initial, onDone }: { initial: string; onDone: (text: string | null) => void }) {
  const ref = useRef<HTMLInputElement>(null);
  const done = useRef(false);
  const finish = (text: string | null) => {
    if (done.current) return;
    done.current = true;
    onDone(text);
  };
  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);
  return (
    <div className="option-row voice-name">
      <input
        ref={ref}
        className="value-input"
        defaultValue={initial}
        maxLength={60}
        placeholder="Name"
        aria-label="Name this voice"
        spellCheck={false}
        autoComplete="off"
        onMouseEnter={keyboardOver}
        onMouseDown={keyboardNow}
        onClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          if (event.key === "Enter") finish(event.currentTarget.value);
          else if (event.key === "Escape") finish(null);
        }}
        onBlur={(event) => {
          finish(event.currentTarget.value === initial ? null : event.currentTarget.value);
          releaseKeyboardSoon();
        }}
      />
    </div>
  );
}
