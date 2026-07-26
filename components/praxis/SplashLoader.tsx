"use client";

import { useEffect, useState } from "react";
import { PraxisLogoFull } from "@/components/praxis/PraxisLogo";

/**
 * Full-screen splash loader shown on initial page load.
 *
 * 1. Fades in the logo with a subtle upward drift
 * 2. Gold accent line animates beneath the mark
 * 3. After a minimum display time (~2.2s), crossfades out to reveal the page
 *
 * Uses a CSS-only approach for the animations to avoid layout thrash.
 * Mounts once and unmounts after exit — no re-renders once gone.
 */
export function SplashLoader() {
  const [phase, setPhase] = useState<"visible" | "exiting" | "done">("visible");

  useEffect(() => {
    // Hold the splash for a minimum duration, then begin exit
    const hold = setTimeout(() => setPhase("exiting"), 2200);
    return () => clearTimeout(hold);
  }, []);

  useEffect(() => {
    if (phase !== "exiting") return;
    // After the fade-out transition ends, remove from DOM
    const cleanup = setTimeout(() => setPhase("done"), 600);
    return () => clearTimeout(cleanup);
  }, [phase]);

  if (phase === "done") return null;

  return (
    <div
      className={`splash-loader ${phase === "exiting" ? "splash-exit" : ""}`}
      aria-hidden="true"
    >
      {/* Subtle radial gold ambient glow — matches the site's body::after */}
      <div className="splash-glow" />

      {/* Logo lockup with staggered entry */}
      <div className="splash-content">
        <PraxisLogoFull size={72} className="splash-logo" />

        {/* Animated gold line beneath logo */}
        <div className="splash-line-track">
          <div className="splash-line" />
        </div>
      </div>
    </div>
  );
}
