import { useCallback, useEffect, useRef, useState, type MouseEvent, type ReactNode } from "react";
import { anchorOf, FloatMenu, MenuRow, type Anchor } from "./FloatMenu.tsx";
import type { IslandAction, IslandState, MicView } from "./types.ts";

/**
 * Which mic records the rep, on the wave: the wave is the rep's audio, so hovering it says which mic that is, and
 * "Change" turns the same card into the list. Nothing is added to the bar, and a click on the bar still opens and closes
 * the island. Closed, the island is too small for a card: the wave's tooltip names the mic instead.
 */

type Act = (action: IslandAction) => void;

const LEGEND = "Beige is you speaking, white is them";

/** "Change" in a line under the controls opens the wave's list (the two live in different parts of the island). */
const openers = new Set<() => void>();
const openMicList = () => openers.forEach((open) => open());

/** The mic on show when recording: `mic` as the dashboard reports it, once it names the mic in use. */
const recordingMic = (state: IslandState): (MicView & { inUse: string }) | null =>
  state.mode.kind === "recording" && state.mic?.inUse ? (state.mic as MicView & { inUse: string }) : null;

/** The wave's tooltip: the mic, then who is who. None while open on a known mic: the card says both. */
export function waveTitle(state: IslandState, open: boolean): string | undefined {
  const mic = recordingMic(state);
  if (!mic) return LEGEND;
  return open ? undefined : `Mic: ${mic.inUse} · ${LEGEND}`;
}

export function MicWave({ state, open, act, children }: { state: IslandState; open: boolean; act: Act; children: ReactNode }) {
  const wave = useRef<HTMLSpanElement>(null);
  const [anchor, setAnchor] = useState<Anchor | null>(null);
  const [list, setList] = useState(false);
  const leaving = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const mic = open ? recordingMic(state) : null;
  const active = mic !== null;

  const show = useCallback(() => {
    clearTimeout(leaving.current);
    if (wave.current) setAnchor(anchorOf(wave.current));
  }, []);
  // The card stays while the pointer moves onto it; the list stays until a pick or a click elsewhere.
  const hide = () => {
    clearTimeout(leaving.current);
    leaving.current = setTimeout(() => setList((listed) => (listed ? listed : (setAnchor(null), false))), 250);
  };
  const close = useCallback(() => {
    clearTimeout(leaving.current);
    setAnchor(null);
    setList(false);
  }, []);

  useEffect(() => {
    if (!active) return;
    const opener = () => {
      setList(true);
      show();
    };
    openers.add(opener);
    return () => void openers.delete(opener);
  }, [active, show]);
  useEffect(() => () => clearTimeout(leaving.current), []);

  if (!mic) return <>{children}</>;
  const pick = (picked: { id: string; label: string } | null) => {
    act({ name: "pickMic", mic: picked });
    close();
  };
  const connected = (id: string) => mic.devices.some((d) => d.id === id);
  return (
    <>
      <span ref={wave} className="mic-wave" onMouseEnter={show} onMouseLeave={hide}>
        {children}
      </span>
      {anchor && (
        <FloatMenu anchor={anchor} width={310} role={list ? "listbox" : "group"} align="end" onClose={close} label="Microphone">
          <div onMouseEnter={() => clearTimeout(leaving.current)} onMouseLeave={hide}>
            {list ? (
              <>
                <MenuRow label={mic.defaultLabel ? `System default (${mic.defaultLabel})` : "System default"} selected={mic.chosen === null} onPick={() => pick(null)} />
                <div className="hairline menu-divider" />
                {mic.devices.map((device) => (
                  <MenuRow key={device.id} label={device.label} selected={mic.chosen?.id === device.id} onPick={() => pick(device)} />
                ))}
                {/* The picked mic while it is not connected: still the rep's, used again once it is back. */}
                {mic.chosen && !connected(mic.chosen.id) && !mic.devices.some((d) => d.label === mic.chosen?.label) && (
                  <MenuRow label={`${mic.chosen.label} (not connected)`} selected dim onPick={close} />
                )}
              </>
            ) : (
              <>
                <div className="option-row mic-card-row">
                  <span>
                    Mic: <span className="mic-card-name">{mic.inUse}</span>
                  </span>
                  <button type="button" className="type-tag-button" onClick={(event: MouseEvent) => (event.stopPropagation(), setList(true))}>
                    <span className="type-note-action">Change</span>
                  </button>
                </div>
                <div className="option-row mic-card-legend" data-dim="true">
                  <span>{LEGEND}</span>
                </div>
              </>
            )}
          </div>
        </FloatMenu>
      )}
    </>
  );
}

/** The recording is not on the rep's usual mic: one line under the controls, where the island's warnings go, without
 * the warning sign (nothing is wrong). It goes once the rep picks, or with the next recording. */
export function MicNoticeLine({ state }: { state: IslandState }) {
  const mic = recordingMic(state);
  if (!mic?.notice) return null;
  return (
    <div className="lost-line" role="status">
      <div className="lost-body mic-line">
        Recording with <span className="mic-card-name">{mic.inUse}</span> <ChangeLink />
      </div>
    </div>
  );
}

/** The mic warning's second line when the mic is known: which one, and Change. */
export function micSilentBody(state: IslandState): ReactNode | null {
  const mic = recordingMic(state);
  if (!mic) return null;
  return (
    <>
      Recording with {mic.inUse} <ChangeLink />
    </>
  );
}

function ChangeLink() {
  return (
    <button type="button" className="type-tag-button" onClick={(event: MouseEvent) => (event.stopPropagation(), openMicList())}>
      <span className="type-note-action">Change</span>
    </button>
  );
}
