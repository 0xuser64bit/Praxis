import type { Metadata } from "next";
import { Geist, Instrument_Serif } from "next/font/google";
import localFont from "next/font/local";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const instrumentSerif = Instrument_Serif({
  variable: "--font-instrument-serif",
  weight: "400",
  style: ["normal", "italic"],
  subsets: ["latin"],
});

// Self-hosted, not next/font/google: Google sometimes serves this family as
// `fonts.gstatic.com/l/font?kit=…&skey=…`, and Turbopack's font-file import
// cannot carry a URL with its own query string ("next/font/google queries
// have exactly one entry"), so the production build failed on whichever
// builder Google answered that way. Latin subset, weights 400–500 (variable),
// OFL-licensed — see app/fonts/JetBrainsMono-OFL.txt.
const jetbrainsMono = localFont({
  src: "./fonts/JetBrainsMono-latin.woff2",
  variable: "--font-jetbrains-mono",
  weight: "400 500",
  display: "swap",
});

// `||` (not `??`) so an empty NEXT_PUBLIC_SITE_URL also falls back, rather than
// producing `new URL("")` → Invalid URL.
const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000";
const SITE_NAME = "Praxis";
const SITE_TAGLINE = "A conversational agent for Solana";
const SITE_DESCRIPTION =
  "Praxis turns plain-language intent into Solana transactions — every action policy-checked against an on-chain Aegis envelope before you sign. You set the caps, you keep custody, you can revoke instantly.";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: `${SITE_NAME} — ${SITE_TAGLINE}`,
    template: `%s · ${SITE_NAME}`,
  },
  description: SITE_DESCRIPTION,
  applicationName: SITE_NAME,
  keywords: [
    "Solana",
    "AI agent",
    "crypto agent",
    "on-chain policy",
    "Aegis",
    "wallet automation",
    "self-custody",
    "policy envelope",
  ],
  authors: [{ name: SITE_NAME }],
  creator: SITE_NAME,
  publisher: SITE_NAME,
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    siteName: SITE_NAME,
    url: SITE_URL,
    title: `${SITE_NAME} — ${SITE_TAGLINE}`,
    description: SITE_DESCRIPTION,
    locale: "en_US",
  },
  twitter: {
    card: "summary_large_image",
    title: `${SITE_NAME} — ${SITE_TAGLINE}`,
    description: SITE_DESCRIPTION,
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${instrumentSerif.variable} ${jetbrainsMono.variable} h-full overflow-x-hidden antialiased`}
    >
      <body className="min-h-full flex flex-col overflow-x-hidden">
        {children}
      </body>
    </html>
  );
}
