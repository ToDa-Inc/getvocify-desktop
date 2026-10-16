// The live assistant's own drawings, by the island's rules (24 grid, round caps, stroke 2), lucide shapes.
const svg = (size: number, stroke = 2) => ({
  width: size, height: size, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: stroke,
  strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true,
});

export const TranscriptIcon = ({ size = 12 }) => (
  <svg {...svg(size)}><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /><path d="M8 8h8M8 12h5" /></svg>
);
export const ConversationIcon = ({ size = 12 }) => (
  <svg {...svg(size)}><path d="m3 17 2 2 4-4M3 7l2 2 4-4M13 6h8M13 12h8M13 18h8" /></svg>
);
export const ShieldIcon = ({ size = 12 }) => (
  <svg {...svg(size)}><path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z" /></svg>
);
export const RecapIcon = ({ size = 12 }) => (
  <svg {...svg(size)}><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" /><path d="M3 3v5h5M12 7v5l4 2" /></svg>
);
export const QuestionIcon = ({ size = 12 }) => (
  <svg {...svg(size)}><path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z" /><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3M12 17h.01" /></svg>
);
export const InfoIcon = ({ size = 11 }) => (
  <svg {...svg(size)}><circle cx="12" cy="12" r="9.5" /><path d="M12 16v-4.5M12 8h.01" /></svg>
);
export const FlagIcon = ({ size = 9 }) => (
  <svg {...svg(size, 2.4)}><path d="M4 22V4a1 1 0 0 1 .4-.8A6 6 0 0 1 8 2c3 0 5 2 7.33 2q2 0 3.67-.8a.5.5 0 0 1 .7.46v10.67a1 1 0 0 1-.4.8A6 6 0 0 1 16 16c-3 0-5-2-8-2a6 6 0 0 0-4 1.528" /></svg>
);
export const ChevronRight = ({ size = 9 }) => <svg {...svg(size, 3)}><path d="m9 6 6 6-6 6" /></svg>;
export const CloseSmall = ({ size = 9 }) => <svg {...svg(size, 2.6)}><path d="M6 6l12 12M18 6 6 18" /></svg>;
