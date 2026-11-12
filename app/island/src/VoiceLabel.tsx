import { useEffect, useRef, useState } from "react";
import { anchorOf, FloatMenu, MenuRow, type Anchor } from "./FloatMenu.tsx";
import { keyboardNow, keyboardOver, releaseKeyboardSoon } from "./keyboard.ts";
import type { Language } from "../../core/typeProposal.ts";
import type { IslandAction, Turn, VoiceChoice } from "./types.ts";
import { pickName, voiceNames } from "./voiceNames.ts";

/**
 * The name above a line from the other side, when the dashboard tells that side's voices apart. One tap opens the people
 * in the meeting (from the calendar, and the names already given): picking one names this voice, and picking a name
 * another voice already has makes them one person. "Someone else" types a name. The dashboard holds the transcript, so
 * the island only asks; the lines change at once.
 */

type Act = (action: IslandAction) => void;
export type VoiceMenu = { voices: VoiceChoice[]; people: string[]; act: Act; language: Language };

const WORDS = {
  en: { fix: "Who is this?", menu: "Who is this?", someone: "Someone else…", name: "Name", nameIt: "Name this voice" },
  es: { fix: "¿Quién es?", menu: "¿Quién es?", someone: "Otra persona…", name: "Nombre", nameIt: "Nombra esta voz" },
};

export function VoiceLabel({ turn, menu }: { turn: Turn; menu: VoiceMenu }) {
  const [anchor, setAnchor] = useState<Anchor | null>(null);
  const [typing, setTyping] = useState(false);
  const words = WORDS[menu.language === "es" ? "es" : "en"];
  const voice = turn.voice as number;
  const names = voiceNames(menu);
  const current = (turn.label ?? "").trim().toLowerCase();
  const close = () => {
    setAnchor(null);
    setTyping(false);
  };
  const choose = (name: string) => {
    const action = pickName(menu, voice, name);
    if (action) menu.act(action);
    close();
  };
  return (
    <>
      <button
        type="button"
        className="turn-label voice-label"
        title={words.fix}
        aria-haspopup="listbox"
        aria-expanded={anchor !== null}
        onClick={(event) => {
          // A click on the label is not a click on the island: it would close it.
          event.stopPropagation();
          setTyping(false);
          setAnchor((open) => (open ? null : anchorOf(event.currentTarget)));
        }}
      >
        {turn.label}
      </button>
      {anchor && (
        <FloatMenu anchor={anchor} width={190} onClose={close} label={words.menu}>
          {typing ? (
            <NameField initial="" words={words} onDone={(text) => (text === null || !text.trim() ? close() : choose(text))} />
          ) : (
            <>
              {names.map((name) => (
                <MenuRow key={name} label={name} selected={name.trim().toLowerCase() === current} onPick={() => choose(name)} />
              ))}
              {names.length > 0 && <div className="hairline menu-divider" />}
              <MenuRow label={words.someone} selected={false} onPick={() => (keyboardNow(), setTyping(true))} />
            </>
          )}
        </FloatMenu>
      )}
    </>
  );
}

/** One line to type a name in. Enter keeps it, Escape drops it; an empty name goes back to the default. */
function NameField({ initial, words, onDone }: { initial: string; words: { name: string; nameIt: string }; onDone: (text: string | null) => void }) {
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
        placeholder={words.name}
        aria-label={words.nameIt}
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
