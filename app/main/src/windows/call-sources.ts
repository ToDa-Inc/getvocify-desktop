import { CallSource } from "../../../core/callSource.ts";

/** What kind of conversation a desktop app is, by executable (the Windows counterpart of `CallSource.app`, which is keyed by Mac bundle ids). */
const BY_EXE: Record<string, CallSource> = {
  "zoom.exe": new CallSource("Zoom", "meeting"),
  "teams.exe": new CallSource("Microsoft Teams", "meeting"),
  "ms-teams.exe": new CallSource("Microsoft Teams", "meeting"),
  "msteams_8wekyb3d8bbwe": new CallSource("Microsoft Teams", "meeting"),
  "slack.exe": new CallSource("Slack", "meeting"),
  "discord.exe": new CallSource("Discord", "meeting"),
  "webex.exe": new CallSource("Webex", "meeting"),
  "ciscocollabhost.exe": new CallSource("Webex", "meeting"),
  "whatsapp.exe": new CallSource("WhatsApp", "call"),
  "5319275a.whatsappdesktop_cv1g1gvanyjgm": new CallSource("WhatsApp", "call"),
  "telegram.exe": new CallSource("Telegram", "call"),
};

/** Null for browsers and unknown apps: their page says what the call is. */
export function callSourceForExe(exeOrId: string | null | undefined): CallSource | null {
  return exeOrId ? (BY_EXE[exeOrId.toLowerCase()] ?? null) : null;
}
