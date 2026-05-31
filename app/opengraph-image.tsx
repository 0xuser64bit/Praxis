import { ImageResponse } from "next/og";

// Branded Open Graph / share card for Praxis. Generated at build time via
// next/og (satori) so a shared link renders a polished preview on social,
// Slack, iMessage, etc. Uses the landing design tokens from app/globals.css.

export const alt = "Praxis — a conversational agent for Solana";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const BG = "#0B0B0C";
const CARD = "#16161A";
const BORDER = "rgba(245, 241, 232, 0.14)";
const TEXT = "#F5F1E8";
const MUTED = "#9D9890";
const FAINT = "#67635D";
const ACCENT = "#C9A05D";
const SUCCESS = "#7FB069";

/** Best-effort web-font fetch; OG render falls back to the built-in font on failure. */
async function loadFont(url: string): Promise<ArrayBuffer | null> {
  try {
    const res = await fetch(url, { cache: "force-cache" });
    if (!res.ok) return null;
    return await res.arrayBuffer();
  } catch {
    return null;
  }
}

export default async function OpengraphImage() {
  const serif = await loadFont(
    "https://github.com/google/fonts/raw/main/ofl/instrumentserif/InstrumentSerif-Regular.ttf",
  );

  const fonts = serif
    ? [{ name: "Instrument Serif", data: serif, style: "normal" as const, weight: 400 as const }]
    : undefined;
  const serifFamily = serif ? "Instrument Serif" : "Georgia, serif";

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          background: BG,
          padding: 72,
          position: "relative",
          fontFamily: "sans-serif",
        }}
      >
        {/* gold ambient glow */}
        <div
          style={{
            position: "absolute",
            top: -260,
            left: 360,
            width: 760,
            height: 760,
            borderRadius: "50%",
            background:
              "radial-gradient(circle at center, rgba(201,160,93,0.20), rgba(201,160,93,0) 60%)",
          }}
        />

        {/* brand row */}
        <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              width: 56,
              height: 56,
              borderRadius: 14,
              background: TEXT,
              color: BG,
              fontSize: 32,
              fontWeight: 600,
            }}
          >
            P
          </div>
          <div
            style={{
              display: "flex",
              fontSize: 22,
              letterSpacing: 6,
              color: FAINT,
              textTransform: "uppercase",
            }}
          >
            Praxis
          </div>
        </div>

        {/* headline */}
        <div style={{ display: "flex", flexDirection: "column" }}>
          <div
            style={{
              display: "flex",
              fontFamily: serifFamily,
              fontSize: 104,
              lineHeight: 1.02,
              letterSpacing: -2,
              color: TEXT,
            }}
          >
            Trade Solana
          </div>
          <div
            style={{
              display: "flex",
              fontFamily: serifFamily,
              fontSize: 104,
              lineHeight: 1.02,
              letterSpacing: -2,
              color: TEXT,
            }}
          >
            by saying it.
          </div>
          <div
            style={{
              display: "flex",
              marginTop: 26,
              maxWidth: 760,
              fontSize: 27,
              lineHeight: 1.45,
              color: MUTED,
            }}
          >
            Every action is checked against your on-chain Aegis policy before you
            sign. You set the caps. You keep custody.
          </div>
        </div>

        {/* command pill + footer */}
        <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 16,
              alignSelf: "flex-start",
              padding: "16px 22px",
              borderRadius: 14,
              background: CARD,
              border: `1px solid ${BORDER}`,
            }}
          >
            <span style={{ color: ACCENT, fontSize: 24 }}>›</span>
            <span style={{ color: TEXT, fontSize: 24, letterSpacing: 0.5 }}>
              send 0.5 sol to savings
            </span>
            <span
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                marginLeft: 10,
                color: SUCCESS,
                fontSize: 20,
              }}
            >
              <span
                style={{
                  width: 11,
                  height: 11,
                  borderRadius: "50%",
                  background: SUCCESS,
                }}
              />
              policy-checked
            </span>
          </div>

          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
            }}
          >
            <div style={{ display: "flex", color: FAINT, fontSize: 22 }}>
              A conversational agent for Solana
            </div>
            <div style={{ display: "flex", color: ACCENT, fontSize: 22 }}>
              praxis
            </div>
          </div>
        </div>
      </div>
    ),
    { ...size, fonts },
  );
}
