// Audio channel frame construction and transcript parsing
export interface TranscriptResult {
  text: string;
  isFinal: boolean;
}

export const ChannelAudio = {
  frame(channel: string, pcm: Uint8Array | Buffer): string {
    const base64 = Buffer.from(pcm).toString("base64");
    const payload = {
      type: "AddChannelAudio",
      channel: channel,
      data: base64,
    };
    return JSON.stringify(payload);
  },

  transcriptText(event: Record<string, any>): TranscriptResult | null {
    if (event["type"] !== "Results") return null;
    const channel = event["channel"] as Record<string, any> | undefined;
    const alternatives = channel?.["alternatives"] as Array<Record<string, any>> | undefined;
    const text = (alternatives?.[0]?.["transcript"] as string) ?? "";
    const isFinal = (event["is_final"] as boolean) === true || (event["speech_final"] as boolean) === true;
    return { text, isFinal };
  },

  speaker(event: Record<string, any>): string {
    const raw = event["audio_channel"] as string | number | undefined;
    if (typeof raw === "string") {
      const value = raw.trim().toLowerCase();
      if (value === "rep" || value === "you") return "rep";
      if (value === "prospect" || value === "them") return "prospect";
    }
    if (typeof raw === "number") {
      return raw === 0 ? "prospect" : "rep";
    }
    const channel = event["channel_index"] as number[] | undefined;
    if (Array.isArray(channel) && channel.length > 0) {
      return channel[0] === 0 ? "prospect" : "rep";
    }
    return "";
  },
};
