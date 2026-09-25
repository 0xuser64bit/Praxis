/**
 * PraxisLogo — the Praxis brand mark as an inline SVG: the icon-only "P"
 * letterform.
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

/** The icon-only "P" mark — the abstract letterform with gold accent. */
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
