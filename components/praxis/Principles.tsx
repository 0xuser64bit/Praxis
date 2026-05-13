import { ContainerNarrow } from "@/components/praxis/ContainerNarrow";
import { Eyebrow } from "@/components/praxis/Eyebrow";

type Principle = {
  mark: string;
  title: { lead: string; accent: string };
  body: string;
};

const PRINCIPLES: Principle[] = [
  {
    mark: "i.",
    title: { lead: "We will not ", accent: "hold your keys." },
    body: "Praxis is non-custodial today and tomorrow. When autonomous actions ship in v2, you'll grant scoped permissions through session keys — not surrender control. The agent operates inside an envelope you set, with limits it cannot cross.",
  },
  {
    mark: "ii.",
    title: { lead: "We will not ", accent: "guess." },
    body: "If your intent is ambiguous, Praxis asks. Two Toms in your contacts? It asks which. Token symbol collides? It asks which. Better one extra question than one wrong transaction. The agent is the interpreter; you remain the decider.",
  },
  {
    mark: "iii.",
    title: { lead: "We will not ", accent: "chase every token." },
    body: "Verified tokens only by default. Unverified mints require an eyes-open override and a second confirmation. The agent is conservative by construction. Memecoin sniping is not the product. Not yet, perhaps not ever.",
  },
  {
    mark: "iv.",
    title: { lead: "We will not ", accent: "pretend to be your advisor." },
    body: "Praxis surfaces data and executes verified actions. It does not tell you to buy, sell, or hold. Markets are markets; decisions remain yours. The product is a sharper tool, not a louder voice.",
  },
  {
    mark: "v.",
    title: { lead: "We will not ", accent: "hide the fees." },
    body: 'Network fees, swap fees, our fees — all surfaced before you sign. No hidden spreads. No "convenience markups." A small, predictable fee on swaps funds the product. That\'s it.',
  },
];

export function Principles() {
  return (
    <section id="principles" className="py-[140px] max-[960px]:py-[100px]">
      <ContainerNarrow>
        <div className="mb-20 max-w-[720px]">
          <Eyebrow accent className="mb-5 block">
            — 05 / Principles
          </Eyebrow>
          <h2 className="[font-family:var(--font-serif)] text-[clamp(40px,5.5vw,72px)] leading-[1.02] tracking-[-0.03em] [&_em]:text-[var(--accent)] [&_em]:italic">
            What we
            <br />
            <em>won&apos;t</em> do.
          </h2>
          <p className="mt-7 max-w-[540px] text-[19px] leading-[1.55] text-[var(--text-secondary)]">
            Conversational interfaces in crypto are easy to build badly and
            dangerous when built carelessly. These are the lines we draw and
            won&apos;t cross — even when it would be convenient.
          </p>
        </div>

        <div className="pt-[60px] [border-top:0.5px_solid_var(--border)]">
          {PRINCIPLES.map((p) => (
            <div
              key={p.mark}
              className="grid grid-cols-[1fr_2fr] items-baseline gap-x-20 py-[50px] [border-bottom:0.5px_solid_var(--border)] max-[960px]:grid-cols-1 max-[960px]:gap-x-0 max-[960px]:gap-y-4"
            >
              <div className="[font-family:var(--font-serif)] text-[24px] text-[var(--accent)] italic">
                {p.mark}
              </div>
              <div>
                <h3 className="mb-4 [font-family:var(--font-serif)] text-[34px] leading-[1.1] tracking-[-0.02em] [&_em]:text-[var(--accent)] [&_em]:italic">
                  {p.title.lead}
                  <em>{p.title.accent}</em>
                </h3>
                <p className="max-w-[540px] text-[16px] leading-[1.6] text-[var(--text-secondary)]">
                  {p.body}
                </p>
              </div>
            </div>
          ))}
        </div>
      </ContainerNarrow>
    </section>
  );
}
