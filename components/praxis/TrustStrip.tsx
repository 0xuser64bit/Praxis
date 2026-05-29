import type { ReactNode } from "react";

import { Container } from "@/components/praxis/Container";
import { Eyebrow } from "@/components/praxis/Eyebrow";

type TrustItem = {
  eyebrow: string;
  value: ReactNode;
  sub: string;
};

const TRUST_ITEMS: TrustItem[] = [
  {
    eyebrow: "Scoped signer",
    value: (
      <>
        <em>Revocable</em>
      </>
    ),
    sub: "Agent authority dies on-chain when revoked",
  },
  {
    eyebrow: "Simulated",
    value: (
      <>
        T1<em>-T6</em>
      </>
    ),
    sub: "LiteSVM enforcement gate covers edge cases",
  },
  {
    eyebrow: "Current scope",
    value: "SOL",
    sub: "Native transfers enforced by Aegis",
  },
  {
    eyebrow: "Swap status",
    value: (
      <>
        v<em>2</em>
      </>
    ),
    sub: "Jupiter execution is not implemented yet",
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
              <div className="text-[13px] text-[var(--text-tertiary)]">
                {item.sub}
              </div>
            </div>
          ))}
        </div>
      </Container>
    </section>
  );
}
