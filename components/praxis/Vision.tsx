import { Container } from "@/components/praxis/Container";
import { Eyebrow } from "@/components/praxis/Eyebrow";

type Phase = {
  num: string;
  phase: string;
  title: string;
  body: string;
};

/**
 * Kept honest against what has already shipped. Phase 01 used to be
 * "recurring & scheduled action" — which has been running since the
 * scheduler landed, and a roadmap that promises a feature the product
 * already has is a roadmap nobody reads twice.
 */
const PHASES: Phase[] = [
  {
    num: "01",
    phase: "Next",
    title: "Swaps the program can police",
    body: "Live Jupiter routing — but only once mint, program, and value limits live inside the swap instruction itself. A swap that could slip outside the envelope would break the whole promise, so it ships when the program can bound it, not a day sooner. Until then the intent is parsed, priced, previewed and refused.",
  },
  {
    num: "02",
    phase: "In design",
    title: "Refusals as durable as approvals",
    body: "An allowed action lands in the program's own ActionLog; a refused one reverts, so its proof lives only in a failed transaction's logs. That asymmetry is backwards for a product whose argument is the refusal. An indexer that keeps rejections as permanently as the chain keeps approvals fixes it.",
  },
  {
    num: "03",
    phase: "Horizon",
    title: "Hands for the agent economy",
    body: "Open the same Aegis envelope to other autonomous agents. Anything that needs to pay, rebalance, or transact on-chain can borrow Praxis's scoped, revocable authority instead of a naked private key. Praxis becomes the safe hands the agent economy moves through.",
  },
];

export function Vision() {
  return (
    <section id="vision" className="py-[140px] max-[960px]:py-[100px]">
      <Container>
        <div className="mb-20 max-w-[720px]">
          <Eyebrow accent className="mb-5 block">
            — 06 / What&apos;s next
          </Eyebrow>
          <h2 className="[font-family:var(--font-serif)] text-[clamp(40px,5.5vw,72px)] leading-[1.02] tracking-[-0.03em] [&_em]:text-[var(--accent)] [&_em]:italic">
            Today it acts.
            <br />
            Next, it <em>trades.</em>
          </h2>
          <p className="mt-7 max-w-[560px] text-[19px] leading-[1.55] text-[var(--text-secondary)]">
            Sends, token transfers and recurring buys already prove the thesis:
            an agent can hold signing power without being able to misuse it.
            Everything next widens what it can do — without ever widening the
            envelope it does it inside.
          </p>
        </div>

        <div>
          {PHASES.map((p, i) => (
            <div
              key={p.num}
              className={`grid grid-cols-[200px_1fr_1fr] items-start gap-x-[60px] py-[56px] [border-top:0.5px_solid_var(--border)] max-[960px]:grid-cols-1 max-[960px]:gap-x-0 max-[960px]:gap-y-5 max-[960px]:py-10 ${
                i === PHASES.length - 1
                  ? "[border-bottom:0.5px_solid_var(--border)]"
                  : ""
              }`}
            >
              <div>
                <div className="[font-family:var(--font-serif)] text-[64px] leading-[0.9] text-[var(--accent)] italic max-[960px]:text-[52px]">
                  {p.num}
                </div>
                <div className="mt-4 [font-family:var(--font-mono)] text-[11px] tracking-[0.18em] text-[var(--text-tertiary)] uppercase">
                  {p.phase}
                </div>
              </div>
              <h3 className="[font-family:var(--font-serif)] text-[32px] leading-[1.08] tracking-[-0.02em]">
                {p.title}
              </h3>
              <p className="text-[15px] leading-[1.65] text-[var(--text-secondary)]">
                {p.body}
              </p>
            </div>
          ))}
        </div>

        <p className="mt-16 max-w-[640px] [font-family:var(--font-mono)] text-[13px] leading-[1.7] tracking-[0.02em] text-[var(--text-tertiary)]">
          One rule never changes: new power has to make the safety stronger — it
          never opens an escape hatch.
        </p>
      </Container>
    </section>
  );
}
