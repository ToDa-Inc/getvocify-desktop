import { useEffect, useRef, useState, type ReactNode } from "react";
import { MenuRow } from "./FloatMenu.tsx";
import { keyboardNow, keyboardOver, releaseKeyboardSoon } from "./keyboard.ts";
import type { ContactSearch, PostCallContact } from "./types.ts";

/** The picker's few words, in the language of where it shows. */
export type ContactPickerWords = { placeholder: string; searching: string; none: string; typeToSearch: string };

export const CONTACT_PICKER_WORDS: Record<"en" | "es", ContactPickerWords> = {
  en: { placeholder: "Search name, email or phone", searching: "Searching…", none: "No one found", typeToSearch: "Type to search the CRM" },
  es: { placeholder: "Busca nombre, email o teléfono", searching: "Buscando…", none: "No hay nadie con eso", typeToSearch: "Escribe para buscar en el CRM" },
};

/**
 * Who the call is with: the people Vocify found for it (the chosen one ticked), and anyone the CRM finds once the rep types a
 * name, an email or a phone. The after-call card and the recording island both pick with it; the dashboard does the search.
 * `takeKeys`: opened by the rep to type (a recording's "Change"), so the field has the keyboard at once.
 */
export function ContactPicker({ chosen, contacts, search, onSearch, onPick, words = CONTACT_PICKER_WORDS.en, takeKeys = false, footer }: {
  chosen: string | null;
  contacts: PostCallContact[];
  search: ContactSearch | null;
  onSearch: (query: string) => void;
  onPick: (contact: PostCallContact) => void;
  words?: ContactPickerWords;
  takeKeys?: boolean;
  /** Rows under the people (a recording's "No contact"). */
  footer?: ReactNode;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState(search?.query ?? "");
  useEffect(() => {
    if (takeKeys) keyboardNow();
    input.current?.focus();
    return () => releaseKeyboardSoon();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, when it opens
  }, []);
  // Asked once the rep stops typing; under two letters the people Vocify found are listed again.
  useEffect(() => {
    const trimmed = query.trim();
    const timer = setTimeout(() => onSearch(trimmed.length >= 2 ? trimmed : ""), trimmed.length >= 2 ? 300 : 0);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only the text decides when to ask
  }, [query]);
  const searching = query.trim().length >= 2;
  const answered = searching && search?.query === query.trim();
  const rows = searching ? (answered ? search!.results : []) : contacts;
  const busy = searching && (!answered || search!.busy);
  return (
    <>
      <div className="contact-search">
        <input
          ref={input}
          className="task-input contact-search-input"
          value={query}
          placeholder={words.placeholder}
          spellCheck={false}
          autoComplete="off"
          maxLength={100}
          onMouseEnter={keyboardOver}
          onMouseDown={keyboardNow}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && rows.length > 0) {
              event.preventDefault();
              onPick(rows[0]);
            }
          }}
        />
      </div>
      {rows.map((contact) => (
        <MenuRow key={contact.id} label={contact.name} detail={contact.detail} selected={contact.id === chosen} onPick={() => onPick(contact)} />
      ))}
      {busy && rows.length === 0 && <div className="menu-heading">{words.searching}</div>}
      {!busy && rows.length === 0 && <div className="menu-heading">{searching ? words.none : words.typeToSearch}</div>}
      {footer}
    </>
  );
}
