/**
 * The island never takes the keyboard (a click must not take it from the call), except while a card can still save:
 * then its text fields can be typed in, and a click in one focuses the window like any text field.
 */

/** The pointer is over a field the rep can type in: the click that follows focuses the island. */
export function keyboardOver(): void {
  void window.vocifyIsland?.keyboard?.("over");
}

/** A click in a field: the island must have the keyboard now (Windows may need it brought to the front). */
export function keyboardNow(): void {
  void window.vocifyIsland?.keyboard?.("now");
}

/** Gives the keyboard back once no field of the card has the caret any more (a moment later: focus may be moving). */
export function releaseKeyboardSoon(): void {
  setTimeout(() => {
    const active = document.activeElement;
    if (!(active instanceof HTMLTextAreaElement || active instanceof HTMLInputElement)) void window.vocifyIsland?.keyboard?.("release");
  }, 150);
}
