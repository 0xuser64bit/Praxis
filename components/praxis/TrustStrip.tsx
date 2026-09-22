import type { ReactNode } from "react";

import { Container } from "@/components/praxis/Container";
import { Eyebrow } from "@/components/praxis/Eyebrow";

type TrustItem = {
  eyebrow: string;
  value: ReactNode;
  sub: string;
};

/**
 * Four facts that can be checked, not four adjectives.
 *
 * The previous strip claimed "T1-T6" (the LiteSVM gate has covered T1–T9 since
 * Token-2022 and the vault invariants landed), "Current scope: SOL" (the program has moved SPL and
 * Token-2022 since f689062), and gave swaps the value "v2", which named no
 * version of anything.
 */
const TRUST_ITEMS: TrustItem[] = [
  {
    eyebrow: "Enforcement gate",
    value: (
      <>
        T1<em>–T9</em>
      </>
    ),
    sub: "LiteSVM cases: caps, rollover, signer, revoke, allow-list, SPL, Token-2022, vault invariants",
  },
  {
    eyebrow: "Assets in scope",
    value: (
      <>
        SOL <em>+ SPL</em>
      </>
    ),
    sub: "Native transfers and one configured token envelope, both program-checked",
  },
  {
    eyebrow: "Scoped signer",
    value: (
      <>
        <em>Revocable</em>
      </>
    ),
    sub: "Agent authority is zeroed on-chain the moment you revoke",
  },
  {
    eyebrow: "Swaps",
    value: (
      <>
        Not <em>yet</em>
      </>
    ),
    sub: "Parsed and previewed, never signed — there is no Jupiter CPI",
  },
];

export function TrustStrip() {
  return (
    <section className="pt-10 pb-[120px]">
      <Container>
        <div className="mt-20 grid grid-cols-4 gap-12 py-10 [border-top:0.5px_solid_var(--border)] [border-bottom:0.5px_solid_var(--border)] max-[960px]:grid-cols-2 max-[960px]:gap-8">
          {TRUST_ITEMS.map((item) => (
            <div key={item.eyebrow}>
              <Eyebrow className="mb-3 block">{item.eyebrow}</Eyebrow>
              <div className="mb-2 [font-family:var(--font-serif)] text-[32px] leading-none tracking-[-0.02em] [&_em]:text-[var(--accent)] [&_em]:italic">
                {item.value}
              </div>
              <div className="text-[13px] leading-[1.45] text-[var(--text-tertiary)]">
                {item.sub}
              </div>
            </div>
          ))}
        </div>
      </Container>
    </section>
  );
}
