/**
 * PraxisLogo — inline SVG components for the new Praxis brand mark.
 *
 * Two exports:
 *   <PraxisLogoMark />   — the icon-only "P" letterform (upper portion of SVG)
 *   <PraxisLogoFull />   — full lockup: mark + "Praxis" wordmark
 *
 * The SVG paths are extracted from the generated logo. Colors use the brand
 * palette directly (#F0ECE6 ivory / #C9A95F gold) so they harmonize with
 * the dark `--bg` backgrounds across all surfaces.
 */

import type { CSSProperties } from "react";

interface LogoProps {
  /** Width of the rendered SVG in px. Height scales proportionally. */
  size?: number;
  className?: string;
  style?: CSSProperties;
}

/**
 * The icon-only "P" mark — the abstract letterform with gold accent.
 * Used in the nav, sidebar brand row, and as the splash loader centrepiece.
 */
export function PraxisLogoMark({ size = 32, className, style }: LogoProps) {
  // The mark occupies roughly the upper 67px of the full 107-height viewBox.
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="6 0 72 72"
      width={size}
      height={size}
      className={className}
      style={style}
      aria-hidden="true"
    >
      <path
        fill="#F0ECE6"
        d="m36.4 11.9h10.6c4.3 0 8 0.8 10.7 3.8 2.1 2.4 3 5.3 3.1 8.8 0.3 7.2-2.4 14.3-10.8 16.1-1.7 0.3-3 0.3-4.6 0.4-6.3 0.5-12.1 3.3-15.2 10.2-1.8 4.5-2.1 7.6-2.1 15.8h9.1c-0.6-4.9-0.7-8-0.7-10.2 0-5.9 2.5-11.1 9.9-11.2 4.4-0.1 23.3 0.2 23.6-18.6 0.1-7.7-4.3-13.1-9.8-16.4-3.6-1.8-7-2.6-11.6-2.6h-21.5c0.7 2.9 1.1 7.4 1.1 10v29.3c1.7-3 4.7-5.4 8.2-7.2v-28.2z"
      />
      <path
        fill="#C9A95F"
        d="m56.3 9c7.1 1.3 13.5 7.5 13.7 16 0.3 9.2-5.1 17.6-18.7 18.2-5.6 0.4-11.4 0.2-16.3 4.8-4.5 4.2-6.7 10.1-6.9 19h9.2c-0.5-2.9-0.8-6.8-0.8-10 0-5.9 2.4-11.4 9.9-11.4 3.3-0.1 23.3 0.5 23.6-18.8 0-8.4-5.5-16.1-13.7-17.8z"
      />
    </svg>
  );
}

/**
 * Full logo lockup — "P" mark + "Praxis" wordmark.
 * Used for the splash loader, OG cards, and large presentations.
 */
export function PraxisLogoFull({ size = 94, className, style }: LogoProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 94.1 107"
      width={size}
      height={size * (107 / 94.1)}
      className={className}
      style={style}
      aria-label="Praxis"
    >
      <path
        fill="#F0ECE6"
        d="m36.4 11.9h10.6c4.3 0 8 0.8 10.7 3.8 2.1 2.4 3 5.3 3.1 8.8 0.3 7.2-2.4 14.3-10.8 16.1-1.7 0.3-3 0.3-4.6 0.4-6.3 0.5-12.1 3.3-15.2 10.2-1.8 4.5-2.1 7.6-2.1 15.8h9.1c-0.6-4.9-0.7-8-0.7-10.2 0-5.9 2.5-11.1 9.9-11.2 4.4-0.1 23.3 0.2 23.6-18.6 0.1-7.7-4.3-13.1-9.8-16.4-3.6-1.8-7-2.6-11.6-2.6h-21.5c0.7 2.9 1.1 7.4 1.1 10v29.3c1.7-3 4.7-5.4 8.2-7.2v-28.2z"
      />
      <path
        fill="#C9A95F"
        d="m56.3 9c7.1 1.3 13.5 7.5 13.7 16 0.3 9.2-5.1 17.6-18.7 18.2-5.6 0.4-11.4 0.2-16.3 4.8-4.5 4.2-6.7 10.1-6.9 19h9.2c-0.5-2.9-0.8-6.8-0.8-10 0-5.9 2.4-11.4 9.9-11.4 3.3-0.1 23.3 0.5 23.6-18.8 0-8.4-5.5-16.1-13.7-17.8z"
      />
      <path
        fill="#EEEAE4"
        d="m15.2 78.2h-7.4c0.3 1.5 0.4 2.6 0.4 4.8v13c0 1 0 2.5-0.1 2.9h3.5c-0.1-0.4-0.1-1.8-0.1-3.4v-5.1h2.8c4.5 0 8.3-1.7 8.3-6.3 0.1-3.5-2.8-5.9-7.4-5.9zm-0.9 10.7h-2.8v-9.2h3.1c3 0 4.5 1.6 4.5 4.5s-1 4.7-4.8 4.7zm14.2-2-0.5-3-2.8 0.6c0.3 1 0.4 2.4 0.4 4.6v6.5c0 1.7-0.2 2.8-0.1 3.3h3.3c-0.1-0.8-0.1-2.1-0.1-3.4v-6.8c0.7-1.2 1.6-2.5 3.2-2.5 0.7 0 1.4 0.2 2.4 0.7l0.7-2.6c-0.5-0.4-1.5-0.6-2.3-0.6-1.9 0-3.3 1.4-4.2 3.2zm19.4 9.2v-7.1c0-2.3-1.3-5.1-5.3-5.1-1.9 0-3.6 0.3-5.3 1.5l-0.2 2.1h0.7c0.9-1 2.6-2.3 4.4-2.3 2.4 0 2.8 1.7 2.8 3.2v1.4c-4.7 0.2-8.9 1.6-8.8 5.6 0.1 2.1 1.5 3.8 4.3 3.8 2.2 0 3.8-1 4.7-2.3 0.1 1.1 0.8 2.2 1.5 2.2h0.2l1.7-0.9c-0.4-0.5-0.7-0.9-0.7-2.1zm-2.9-0.5c-0.7 0.9-2 1.7-3.4 1.7-1.5 0-2.2-1-2.2-2.2 0-2.2 2.3-3.6 5.6-3.9v4.4zm19.7-11.5h-2.2l-3.9 5.4-3.7-5.4h-4.1l5.7 7.5-5.9 7.2h2.5c0.5-1 3.6-4.9 4.4-5.8l4 5.8h3.9l-5.9-8.1 5.3-6.6h-0.1zm3.1-4.1m1.8 0m1.8-1.8m-3.6 3.5m3.6-3.5m-3.6 3.5m3.6-3.5m-3.2 6.2c0.2 0.6 0.2 1.7 0.2 2.6v8.6c0 1.7-0.1 3-0.1 3.3h3.2c-0.1-0.4-0.1-1.7-0.1-3.4v-11.5l-3.5 0.4zm1.5-6.4c-1 0.1-1.9 1.1-1.8 2.3 0 0.9 0.9 1.8 1.9 1.7 1 0 2-0.9 2-1.8 0.1-1.3-0.9-2.3-2.1-2.2zm10.5 11.3c-1.1-0.4-2.4-1.1-2.4-2.1-0.1-1.4 1.3-2.1 2.8-2 2.1 0 3.2 1.2 4.7 2.2 0-1.2 0.2-2.4 0.3-2.4-1-0.6-2.6-1.2-4.7-1.2-3 0-5.7 1.3-5.7 4.2 0 2.5 2.3 3.6 4.3 4.4 2.1 0.7 4.1 1.4 4.1 3.3 0 1.4-1.4 2-3 2-2.1 0-3.2-0.9-5.3-2.3l-0.1 2.3c1.6 1 3 1.5 5.5 1.5 2.8 0 5.7-1.1 5.7-4.4 0.2-3.2-3.4-4.4-6.2-5.5z"
      />
    </svg>
  );
}
