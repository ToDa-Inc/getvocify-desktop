/**
 * Whether the hidden dashboard page starts with the app. It does for a rep whose calendar is watched, and for a signed-in
 * rep it has not yet asked: the page reports within seconds whether the calendar is connected (and is given back if not),
 * so the meeting heads-up works from the first launch of a new version without Vocify being opened by hand first.
 */
export function startsPageAtLaunch(settings: { calendarWatch: unknown; recorderReady: unknown }): boolean {
  return settings.calendarWatch === true || (settings.calendarWatch === undefined && settings.recorderReady === true);
}
