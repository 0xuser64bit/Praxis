import { Container } from "@/components/praxis/Container";
import { Eyebrow } from "@/components/praxis/Eyebrow";

type Phase = {
  num: string;
  phase: string;
  title: string;
  body: string;
};

const PHASES: Phase[] = [
  {
    num: "01",
    phase: "Next",
    title: "Recurring & scheduled action",
    body: "DCA, subscriptions, payroll, treasury sweeps. This is the first thing you genuinely can't do safely any other way — the agent acts while you're asleep, inside caps it still can't exceed. The envelope is what makes “set it and forget it” sane instead of reckless.",
  },
  {
    num: "02",
    phase: "In design",
    title: "Swaps the chain enforces",
    body: "Live Jupiter routing — but only once mint, program, and value limits live inside the swap instruction itself. A swap that could slip outside the envelope would break the whole promise, so it ships when the program can police it, not a day sooner.",
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
            — 07 / What&apos;s next
          </Eyebrow>
          <h2 className="[font-family:var(--font-serif)] text-[clamp(40px,5.5vw,72px)] leading-[1.02] tracking-[-0.03em] [&_em]:text-[var(--accent)] [&_em]:italic">
            Today it sends.
            <br />
            Next, it <em>acts.</em>
          </h2>
          <p className="mt-7 max-w-[560px] text-[19px] leading-[1.55] text-[var(--text-secondary)]">
            The send flow already proves the thesis: an agent can hold signing
            power without being able to misuse it. Everything next widens what
            it can do — without ever leaving the envelope.
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
