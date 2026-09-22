import { DEFAULT_AEGIS_PROGRAM_ID_BASE58 } from "@praxis/shared";

import { Container } from "@/components/praxis/Container";
import { PraxisLogoMark } from "@/components/praxis/PraxisLogo";

const REPO_URL = "https://github.com/0xuser64bit/Praxis";

/**
 * Only links that go somewhere.
 *
 * This shipped with twelve `href="#"` entries — Documentation, Manifesto,
 * Security, Press kit, About, Careers, Brand, Contact, and four socials — none
 * of which existed. A footer full of dead links is worse than a short one: it
 * invites a click and answers with a jump to the top of the page.
 */
type FooterColumn = {
  title: string;
  links: { label: string; href: string; external?: boolean }[];
};

const FOOTER_COLS: FooterColumn[] = [
  {
    title: "Product",
    links: [
      { label: "Launch app", href: "/app" },
      { label: "Inside the app", href: "#inside" },
      { label: "Why Praxis", href: "#why" },
      { label: "How it works", href: "#how" },
      { label: "What's next", href: "#vision" },
    ],
  },
  {
    title: "Build",
    links: [
      { label: "Source", href: REPO_URL, external: true },
      { label: "Architecture", href: `${REPO_URL}/blob/main/docs/ARCHITECTURE.md`, external: true },
      { label: "Deploy guide", href: `${REPO_URL}/blob/main/docs/DEPLOY.md`, external: true },
      { label: "@usepraxis/sdk", href: `${REPO_URL}/tree/main/sdk#readme`, external: true },
    ],
  },
  {
    title: "On-chain",
    links: [
      {
        label: "Aegis program",
        href: `https://explorer.solana.com/address/${DEFAULT_AEGIS_PROGRAM_ID_BASE58}?cluster=devnet`,
        external: true,
      },
      {
        label: "Principles",
        href: "#principles",
      },
    ],
  },
];

export function Footer() {
  return (
    <footer className="pt-20 pb-8 [border-top:0.5px_solid_var(--border)]">
      <Container>
        <div className="mb-[60px] grid grid-cols-[2fr_1fr_1fr_1fr] gap-10 max-[960px]:grid-cols-2">
          <div>
            <div className="mb-4 flex items-center gap-2.5 [font-family:var(--font-serif)] text-[22px] tracking-[-0.02em]">
              <PraxisLogoMark size={24} />
              <span>Praxis</span>
            </div>
            <p className="max-w-[260px] [font-family:var(--font-serif)] text-[18px] leading-[1.4] text-[var(--text-secondary)] italic">
              From intent, to action.
              <br />
              Built quietly on Solana.
            </p>
          </div>

          {FOOTER_COLS.map((col) => (
            <div key={col.title}>
              <h4 className="mb-[18px] [font-family:var(--font-mono)] text-[11px] font-normal tracking-[0.14em] text-[var(--text-tertiary)] uppercase">
                {col.title}
              </h4>
              <ul className="grid list-none gap-2.5">
                {col.links.map((link) => (
                  <li key={link.label}>
                    <a
                      href={link.href}
                      {...(link.external
                        ? { target: "_blank", rel: "noopener noreferrer" }
                        : {})}
                      className="text-[14px] text-[var(--text-secondary)] [transition:color_0.2s] hover:text-[var(--text-primary)]"
                    >
                      {link.label}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 pt-8 [font-family:var(--font-mono)] text-[11px] tracking-[0.05em] text-[var(--text-tertiary)] [border-top:0.5px_solid_var(--border)]">
          <span>© 2026 PRAXIS LABS</span>
          <div className="flex items-center gap-2">
            <span>v0.1 · devnet</span>
            <span
              aria-hidden
              className="h-1.5 w-1.5 rounded-full bg-[var(--success)]"
            />
            <span>Aegis T1–T9 passing</span>
          </div>
        </div>
      </Container>
    </footer>
  );
}
