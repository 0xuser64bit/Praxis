import { Container } from "@/components/praxis/Container";
import { Eyebrow } from "@/components/praxis/Eyebrow";

type Step = {
  numeral: string;
  label: string;
  title: { lead: string; accent: string };
  body: string;
};

const STEPS: Step[] = [
  {
    numeral: "i.",
    label: "Type",
    title: { lead: "You write what\nyou ", accent: "want." },
    body: "Natural language. Misspellings, slang, half-formed thoughts. Praxis parses intent the way a senior trader skims a Telegram message — not the way SQL parses a query. Ambiguity prompts a follow-up; certainty proceeds.",
  },
  {
    numeral: "ii.",
    label: "Verify",
    title: { lead: "Praxis proposes a\nstructured ", accent: "action." },
    body: "Every action is simulated against live chain state before you see it. If a transaction will fail, slip, or pay fees that don't feel right, Praxis tells you — and explains why. The agent is the interpreter. The safety layer is the executor.",
  },
  {
    numeral: "iii.",
    label: "Sign",
    title: { lead: "You confirm.\nIt ", accent: "executes." },
    body: "In the live demo, the scoped agent key can only sign Aegis instructions from the policy vault. Owner/admin actions are the production wallet-signed path; the agent never gets unrestricted wallet authority.",
  },
];

export function HowItWorks() {
  return (
    <section id="how" className="py-[140px] max-[960px]:py-[100px]">
      <Container>
        <div className="mb-20 max-w-[720px]">
          <Eyebrow accent className="mb-5 block">
            — 04 / How it works
          </Eyebrow>
          <h2 className="[font-family:var(--font-serif)] text-[clamp(40px,5.5vw,72px)] leading-[1.02] tracking-[-0.03em] [&_em]:text-[var(--accent)] [&_em]:italic">
            Three steps.
            <br />
            One <em>conversation.</em>
          </h2>
        </div>

        <div>
          {STEPS.map((step, i) => (
            <div
              key={step.numeral}
              className={`grid grid-cols-[200px_1fr_1fr] items-start gap-x-[60px] py-[60px] [border-top:0.5px_solid_var(--border)] max-[960px]:grid-cols-1 max-[960px]:gap-x-0 max-[960px]:gap-y-6 max-[960px]:py-10 ${
                i === STEPS.length - 1
                  ? "[border-bottom:0.5px_solid_var(--border)]"
                  : ""
              }`}
            >
              <div>
                <div className="[font-family:var(--font-serif)] text-[72px] leading-[0.9] text-[var(--accent)] italic max-[960px]:text-[56px]">
                  {step.numeral}
                </div>
                <div className="mt-4 [font-family:var(--font-mono)] text-[11px] tracking-[0.18em] text-[var(--text-tertiary)] uppercase">
                  {step.label}
                </div>
              </div>
              <h3 className="[font-family:var(--font-serif)] text-[36px] leading-[1.05] tracking-[-0.02em] whitespace-pre-line [&_em]:text-[var(--accent)] [&_em]:italic">
                {step.title.lead}
                <em>{step.title.accent}</em>
              </h3>
              <p className="text-[15px] leading-[1.65] text-[var(--text-secondary)]">
                {step.body}
              </p>
            </div>
          ))}
        </div>
      </Container>
    </section>
  );
}
