import { Container } from "@/components/praxis/Container";

type FooterColumn = {
  title: string;
  links: { label: string; href: string }[];
};

const FOOTER_COLS: FooterColumn[] = [
  {
    title: "Product",
    links: [
      { label: "Beta access", href: "#" },
      { label: "Roadmap", href: "#" },
      { label: "Changelog", href: "#" },
      { label: "Status", href: "#" },
    ],
  },
  {
    title: "Resources",
    links: [
      { label: "Documentation", href: "#" },
      { label: "Manifesto", href: "#" },
      { label: "Security", href: "#" },
      { label: "Press kit", href: "#" },
    ],
  },
  {
    title: "Company",
    links: [
      { label: "About", href: "#" },
      { label: "Careers", href: "#" },
      { label: "Brand", href: "#" },
      { label: "Contact", href: "#" },
    ],
  },
  {
    title: "Connect",
    links: [
      { label: "Twitter / X", href: "#" },
      { label: "Discord", href: "#" },
      { label: "GitHub", href: "#" },
      { label: "Mirror", href: "#" },
    ],
  },
];

export function Footer() {
  return (
    <footer className="pt-20 pb-8 [border-top:0.5px_solid_var(--border)]">
      <Container>
        <div className="mb-[60px] grid grid-cols-[2fr_1fr_1fr_1fr_1fr] gap-10 max-[960px]:grid-cols-2">
          <div>
            <div className="mb-4 flex items-center gap-2.5 [font-family:var(--font-serif)] text-[22px] tracking-[-0.02em]">
              <span className="flex h-6 w-6 items-center justify-center rounded-md bg-[var(--text-primary)] [font-family:var(--font-mono)] text-[13px] font-medium text-[var(--bg)]">
                P
              </span>
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

        <div className="flex items-center justify-between pt-8 [font-family:var(--font-mono)] text-[11px] tracking-[0.05em] text-[var(--text-tertiary)] [border-top:0.5px_solid_var(--border)]">
          <span>© 2026 PRAXIS LABS · AHMEDABAD</span>
          <div className="flex items-center gap-2">
            <span>v0.1.2 · last deploy 4h ago</span>
            <span
              aria-hidden
              className="h-1.5 w-1.5 rounded-full bg-[var(--success)]"
            />
            <span>all systems normal</span>
          </div>
        </div>
      </Container>
    </footer>
  );
}
