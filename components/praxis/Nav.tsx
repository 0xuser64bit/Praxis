"use client";

import { useEffect, useState } from "react";

import { Button } from "@/components/praxis/Button";

const NAV_LINKS = [
  { href: "#product", label: "Product" },
  { href: "#how", label: "How it works" },
  { href: "#principles", label: "Principles" },
  { href: "#", label: "Docs" },
] as const;

export function Nav() {
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 20);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const navBg = scrolled
    ? "bg-[rgba(11,11,12,0.85)]"
    : "bg-[rgba(11,11,12,0.7)]";
  const navBorder = scrolled
    ? "border-b-[color:var(--border)]"
    : "border-b-transparent";

  const linkClasses =
    "text-sm text-[var(--text-secondary)] [transition:color_0.2s_ease] hover:text-[var(--text-primary)] max-[960px]:hidden";

  return (
    <nav
      className={`fixed top-0 right-0 left-0 z-[100] border-b-[0.5px] backdrop-blur-[20px] [transition:border-color_0.3s_ease,background_0.3s_ease] ${navBg} ${navBorder}`}
    >
      <div className="mx-auto flex max-w-[1240px] items-center justify-between px-8 py-4">
        <div className="flex items-center gap-2.5 [font-family:var(--font-serif)] text-[22px] tracking-[-0.02em]">
          <span className="flex h-6 w-6 items-center justify-center rounded-md bg-[var(--text-primary)] [font-family:var(--font-mono)] text-[13px] font-medium text-[var(--bg)]">
            P
          </span>
          <span>Praxis</span>
          <span className="ml-1 border-l-[0.5px] border-l-[var(--border)] pl-3 [font-family:var(--font-mono)] text-[10px] tracking-[0.14em] text-[var(--text-tertiary)] uppercase">
            v0.1 · sol
          </span>
        </div>
        <div className="flex items-center gap-8">
          {NAV_LINKS.map((link) => (
            <a key={link.label} href={link.href} className={linkClasses}>
              {link.label}
            </a>
          ))}
          <Button as="a" href="#" size="sm">
            Launch app
            <ArrowUpRight />
          </Button>
        </div>
      </div>
    </nav>
  );
}

function ArrowUpRight() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M17 7L7 17" />
      <path d="M8 7h9v9" />
    </svg>
  );
}
