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
