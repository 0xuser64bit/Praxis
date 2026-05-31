import { IconCheck, IconShieldLock } from "@tabler/icons-react";

import { Container } from "@/components/praxis/Container";
import { Eyebrow } from "@/components/praxis/Eyebrow";

const GUARANTEES = [
  "Per-transaction and daily spend caps",
  "Allow-listed recipients, mints, and programs",
  "A session key with a hard expiry",
  "Instant revoke — the key dies on-chain",
];

export function WhyPraxis() {
  return (
    <section id="why" className="py-[140px] max-[960px]:py-[100px]">
      <Container>
        <div className="mb-20 max-w-[760px]">
          <Eyebrow accent className="mb-5 block">
            — 01 / Why Praxis
          </Eyebrow>
          <h2 className="[font-family:var(--font-serif)] text-[clamp(40px,5.5vw,72px)] leading-[1.02] tracking-[-0.03em] [&_em]:text-[var(--accent)] [&_em]:italic">
            To be useful, it needs
            <br />
            your <em>signing power.</em>
          </h2>
          <p className="mt-7 max-w-[560px] text-[19px] leading-[1.55] text-[var(--text-secondary)]">
            And that&apos;s the whole problem. A bug, a bad parse, a prompt
            injection, a compromised backend — any one of them, and an agent
            holding your keys can drain you. So far the only answers have been
            bad ones.
          </p>
        </div>

        <div className="grid grid-cols-[1fr_1.1fr] gap-5 max-[960px]:grid-cols-1">
          {/* the trap */}
          <div className="rounded-2xl bg-[var(--bg-card)] p-8 [border:0.5px_solid_var(--border)] max-[960px]:p-6">
            <Eyebrow className="mb-7 block">The two old answers</Eyebrow>
            <div className="flex flex-col">
              <div>
                <h3 className="mb-2.5 [font-family:var(--font-serif)] text-[22px] tracking-[-0.015em] text-[var(--text-tertiary)]">
                  Babysit every action
                </h3>
                <p className="text-[14.5px] leading-[1.6] text-[var(--text-secondary)]">
                  Approve each one by hand. Safe — and now it&apos;s just a
                  slower wallet. The agent was supposed to save you the clicks.
                </p>
              </div>
              <div className="my-7 h-px bg-[var(--border)]" />
              <div>
                <h3 className="mb-2.5 [font-family:var(--font-serif)] text-[22px] tracking-[-0.015em] text-[var(--text-tertiary)]">
                  Hand over the keys
                </h3>
                <p className="text-[14.5px] leading-[1.6] text-[var(--text-secondary)]">
                  Let it sign whatever it wants. Useful — until the day a bug, a
                  bad parse, or an attacker turns that power against you.
                </p>
              </div>
            </div>
          </div>

          {/* the envelope */}
          <div className="rounded-2xl bg-[var(--bg-card)] p-8 [border:0.5px_solid_rgba(201,160,93,0.3)] [box-shadow:0_0_70px_-24px_rgba(201,160,93,0.28)] max-[960px]:p-6">
            <div className="mb-6 flex items-center gap-2.5">
              <span
                className="flex h-8 w-8 items-center justify-center rounded-lg"
                style={{ background: "var(--accent-dim)", color: "var(--accent)" }}
              >
                <IconShieldLock size={17} />
              </span>
              <Eyebrow accent>Enforced by Aegis, on-chain</Eyebrow>
            </div>
            <h3 className="mb-5 [font-family:var(--font-serif)] text-[26px] leading-[1.1] tracking-[-0.015em]">
              An envelope the agent can&apos;t cross.
            </h3>
            <ul className="flex flex-col gap-3.5">
              {GUARANTEES.map((g) => (
                <li key={g} className="flex items-start gap-3 text-[15px] leading-[1.45] text-[var(--text-primary)]">
                  <IconCheck size={17} className="mt-[2px] shrink-0 text-[var(--accent)]" />
                  <span>{g}</span>
                </li>
              ))}
            </ul>
            <p className="mt-7 pt-6 text-[14px] leading-[1.65] text-[var(--text-secondary)] [border-top:0.5px_solid_var(--border)]">
              Ask it to send 50 SOL when your cap is 5, and the transaction
              simply fails. Not because our server said no — because the Solana
              program won&apos;t sign it.
            </p>
          </div>
        </div>

        {/* pull quote */}
        <div className="mt-[120px] text-center max-[960px]:mt-20">
          <p className="mx-auto max-w-[820px] [font-family:var(--font-serif)] text-[clamp(30px,4.5vw,52px)] leading-[1.12] tracking-[-0.02em] italic">
            The agent proposes.{" "}
            <span className="text-[var(--accent)]">The chain disposes.</span>
          </p>
        </div>
      </Container>
    </section>
  );
}
