import { useId } from "react";

interface Props {
  /** Width in px; the figure keeps its proportions. */
  size?: number;
  /** A small, still version for message avatars (no hologram base, no animation). */
  mini?: boolean;
}

/**
 * Arachi AI's face: a floating glass "hologram" with a blinking face, projected
 * from a glowing base. Pure SVG + CSS (see .mascot in styles.css), so it needs
 * no image file and stays crisp at any size.
 */
export default function AiMascot({ size = 150, mini = false }: Props) {
  const id = useId().replace(/:/g, "");
  const grad = `${id}-body`;
  const beam = `${id}-beam`;
  const glow = `${id}-glow`;
  const clip = `${id}-clip`;

  if (mini) {
    return (
      <svg className="mascot mini" width={size} height={size} viewBox="0 0 64 64" role="img" aria-label="Arachi AI">
        <defs>
          <linearGradient id={grad} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#6c8dff" />
            <stop offset="1" stopColor="#0037b8" />
          </linearGradient>
        </defs>
        <rect x="6" y="6" width="52" height="52" rx="16" fill={`url(#${grad})`} />
        <rect x="6" y="6" width="52" height="26" rx="16" fill="#fff" opacity="0.14" />
        <circle cx="23" cy="30" r="4.4" fill="#fff" />
        <circle cx="41" cy="30" r="4.4" fill="#fff" />
        <path d="M24 42 Q32 49 40 42" fill="none" stroke="#fff" strokeWidth="3.2" strokeLinecap="round" />
      </svg>
    );
  }

  return (
    <svg
      className="mascot"
      width={size}
      height={size * 1.15}
      viewBox="0 0 160 184"
      role="img"
      aria-label="Arachi AI köməkçisi"
    >
      <defs>
        <linearGradient id={grad} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#7d9bff" />
          <stop offset="0.55" stopColor="#2f63e0" />
          <stop offset="1" stopColor="#0037b8" />
        </linearGradient>
        <linearGradient id={beam} x1="0" y1="1" x2="0" y2="0">
          <stop offset="0" stopColor="#6c8dff" stopOpacity="0.5" />
          <stop offset="1" stopColor="#6c8dff" stopOpacity="0" />
        </linearGradient>
        <radialGradient id={glow} cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor="#6c8dff" stopOpacity="0.55" />
          <stop offset="1" stopColor="#6c8dff" stopOpacity="0" />
        </radialGradient>
        <clipPath id={clip}>
          <rect x="34" y="22" width="92" height="92" rx="28" />
        </clipPath>
      </defs>

      {/* Projection beam and base rings */}
      <polygon className="mascot-beam" points="52,150 108,150 128,96 32,96" fill={`url(#${beam})`} />
      <ellipse className="mascot-ring r1" cx="80" cy="156" rx="52" ry="10" fill="none" stroke="#6c8dff" strokeWidth="2" />
      <ellipse className="mascot-ring r2" cx="80" cy="156" rx="34" ry="6.5" fill="none" stroke="#0037b8" strokeWidth="2" />
      <ellipse cx="80" cy="156" rx="60" ry="14" fill={`url(#${glow})`} />

      {/* The floating figure */}
      <g className="mascot-float">
        <ellipse cx="80" cy="68" rx="70" ry="64" fill={`url(#${glow})`} />
        <rect x="34" y="22" width="92" height="92" rx="28" fill={`url(#${grad})`} />
        <g clipPath={`url(#${clip})`}>
          <rect x="34" y="22" width="92" height="42" fill="#fff" opacity="0.16" />
          <rect className="mascot-scan" x="34" y="0" width="92" height="14" fill="#fff" opacity="0.28" />
          {Array.from({ length: 12 }, (_, i) => (
            <rect key={i} x="34" y={26 + i * 8} width="92" height="1.4" fill="#fff" opacity="0.08" />
          ))}
        </g>
        <rect x="34" y="22" width="92" height="92" rx="28" fill="none" stroke="#fff" strokeOpacity="0.55" strokeWidth="1.6" />
        <g className="mascot-eyes">
          <ellipse cx="61" cy="62" rx="8" ry="9.5" fill="#fff" />
          <ellipse cx="99" cy="62" rx="8" ry="9.5" fill="#fff" />
        </g>
        <path d="M64 86 Q80 100 96 86" fill="none" stroke="#fff" strokeWidth="5" strokeLinecap="round" />
      </g>
    </svg>
  );
}
