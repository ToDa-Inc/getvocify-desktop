import type { CSSProperties } from "react";

type IconProps = { size?: number; stroke?: number; style?: CSSProperties; className?: string };

const base = (size: number, stroke: number, style?: CSSProperties, className?: string) => ({
  width: size,
  height: size,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: stroke,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  style,
  className,
  "aria-hidden": true,
});

export const ChevronDown = ({ size = 10, stroke = 3, style, className }: IconProps) => (
  <svg {...base(size, stroke, style, className)}><path d="m6 9 6 6 6-6" /></svg>
);
export const ArrowUpRight = ({ size = 12, stroke = 2, style, className }: IconProps) => (
  <svg {...base(size, stroke, style, className)}><path d="M7 17 17 7M8 7h9v9" /></svg>
);
export const ArrowDown = ({ size = 10, stroke = 2.4, style, className }: IconProps) => (
  <svg {...base(size, stroke, style, className)}><path d="M12 5v14M6 13l6 6 6-6" /></svg>
);
export const Close = ({ size = 11, stroke = 2.2, style, className }: IconProps) => (
  <svg {...base(size, stroke, style, className)}><path d="M6 6l12 12M18 6 6 18" /></svg>
);
export const Check = ({ size = 10, stroke = 3.2, style, className }: IconProps) => (
  <svg {...base(size, stroke, style, className)}><path d="m5 12.5 4.5 4.5L19 7.5" /></svg>
);
export const Pause = ({ size = 10, style, className }: IconProps) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" style={style} className={className} aria-hidden>
    <rect x="5" y="4" width="5" height="16" rx="1.4" /><rect x="14" y="4" width="5" height="16" rx="1.4" />
  </svg>
);
export const Play = ({ size = 10, style, className }: IconProps) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" style={style} className={className} aria-hidden>
    <path d="M7 4.6v14.8a1 1 0 0 0 1.5.86l12.2-7.4a1 1 0 0 0 0-1.72L8.5 3.74A1 1 0 0 0 7 4.6Z" />
  </svg>
);
export const Sparkle = ({ size = 10, style, className }: IconProps) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" style={style} className={className} aria-hidden>
    <path d="M12 1.5c.5 5.6 4.9 10 10.5 10.5-5.6.5-10 4.9-10.5 10.5C11.5 16.9 7.1 12.5 1.5 12 7.1 11.5 11.5 7.1 12 1.5Z" />
  </svg>
);
export const AlertCircle = ({ size = 12, style, className }: IconProps) => (
  <svg width={size} height={size} viewBox="0 0 24 24" style={style} className={className} aria-hidden>
    <circle cx="12" cy="12" r="11" fill="currentColor" />
    <path d="M12 6.5v6.4" stroke="#000" strokeOpacity=".78" strokeWidth="2.4" strokeLinecap="round" />
    <circle cx="12" cy="17" r="1.45" fill="#000" fillOpacity=".78" />
  </svg>
);
export const Waveform = ({ size = 12, stroke = 2.2, style, className }: IconProps) => (
  <svg {...base(size, stroke, style, className)}><path d="M4 10v4M8 7v10M12 4v16M16 8v8M20 11v2" /></svg>
);

/* The after-call card's symbols (SF Symbols in the Mac app), drawn with the same stroke as the others. */
export const IdCard = ({ size = 11, stroke = 2, style, className }: IconProps) => (
  <svg {...base(size, stroke, style, className)}><rect x="3" y="5" width="18" height="14" rx="2.5" /><circle cx="9" cy="11" r="2" /><path d="M6 16c.6-1.4 1.7-2 3-2s2.4.6 3 2M14.5 10h3.5M14.5 13.5h3.5" /></svg>
);
export const Mail = ({ size = 11, stroke = 2, style, className }: IconProps) => (
  <svg {...base(size, stroke, style, className)}><rect x="3" y="5" width="18" height="14" rx="2.5" /><path d="m3.5 7 8.5 6 8.5-6" /></svg>
);
export const FileText = ({ size = 11, stroke = 2, style, className }: IconProps) => (
  <svg {...base(size, stroke, style, className)}><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" /><path d="M14 3v5h5M9 13h6M9 17h6" /></svg>
);
export const Calendar = ({ size = 10, stroke = 2, style, className }: IconProps) => (
  <svg {...base(size, stroke, style, className)}><rect x="3.5" y="5" width="17" height="15.5" rx="2.5" /><path d="M8 3v4M16 3v4M3.5 10h17" /></svg>
);
export const Users = ({ size = 10.5, stroke = 2.2, style, className }: IconProps) => (
  <svg {...base(size, stroke, style, className)}><circle cx="9" cy="8" r="3.2" /><path d="M3 19.5c.8-3 3.2-4.6 6-4.6s5.2 1.6 6 4.6M15.5 5.2a3 3 0 0 1 0 5.6M18 14.6c1.6.6 2.6 2.2 3 4.9" /></svg>
);
export const ExclamationCircle = ({ size = 10.5, stroke = 2.2, style, className }: IconProps) => (
  <svg {...base(size, stroke, style, className)}><circle cx="12" cy="12" r="9" /><path d="M12 7.5v5.5M12 16.5v.01" /></svg>
);

/* Calling (the Mac app draws these with SF Symbols: phone.fill, phone.down.fill, mic.fill, mic.slash.fill, circle.grid.3x3.fill). */
const HANDSET =
  "M20.5 15.6v3.1a2 2 0 0 1-2.2 2A18.6 18.6 0 0 1 3.3 5.7 2 2 0 0 1 5.3 3.5h3.1a2 2 0 0 1 2 1.7c.13.95.37 1.88.7 2.77a2 2 0 0 1-.45 2.11L9.33 11.4a15 15 0 0 0 3.27 3.27l1.32-1.32a2 2 0 0 1 2.1-.45c.9.33 1.83.57 2.78.7a2 2 0 0 1 1.7 2z";
const filled = (size: number, style?: CSSProperties, className?: string) => ({
  width: size,
  height: size,
  viewBox: "0 0 24 24",
  fill: "currentColor",
  style,
  className,
  "aria-hidden": true,
});
export const Phone = ({ size = 11, style, className }: IconProps) => (
  <svg {...filled(size, style, className)}><path d={HANDSET} /></svg>
);
export const PhoneDown = ({ size = 11, style, className }: IconProps) => (
  <svg {...filled(size, style, className)}><path d={HANDSET} transform="rotate(135 12 12)" /></svg>
);
export const Mic = ({ size = 10, style, className }: IconProps) => (
  <svg {...filled(size, style, className)}>
    <rect x="8.5" y="2" width="7" height="12.5" rx="3.5" />
    <path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V22" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
  </svg>
);
export const MicSlash = ({ size = 10, style, className }: IconProps) => (
  <svg {...filled(size, style, className)}>
    <rect x="8.5" y="2" width="7" height="12.5" rx="3.5" />
    <path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V22M4 3l16 18" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
  </svg>
);
export const Keypad = ({ size = 10, style, className }: IconProps) => (
  <svg {...filled(size, style, className)}>
    {[5, 12, 19].flatMap((y) => [5, 12, 19].map((x) => <circle key={`${x}-${y}`} cx={x} cy={y} r="2.3" />))}
  </svg>
);
