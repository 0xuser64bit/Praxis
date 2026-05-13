import {
  IconArrowRight,
  IconBolt,
  IconLock,
  IconPlayerPlay,
  IconShieldCheck,
} from "@tabler/icons-react";
import { Fragment } from "react";

import { Button } from "@/components/praxis/Button";
import { Container } from "@/components/praxis/Container";
import { Eyebrow } from "@/components/praxis/Eyebrow";

const META_ITEMS = [
  { Icon: IconShieldCheck, label: "Non-custodial" },
  { Icon: IconBolt, label: "Built on Solana" },
  { Icon: IconLock, label: "Your keys, always" },
] as const;

export function Hero() {
  return (
    <section className="relative pt-[200px] max-[960px]:pt-[140px]">
      <Container>
        <div className="max-w-[920px]">
          <div className="mb-9 inline-flex items-center gap-2.5 rounded-full px-3.5 py-1.5 [border:0.5px_solid_var(--border-strong)] [animation:fadeUp_0.8s_ease_both]">
            <PulseDot />
            <Eyebrow>Private beta · 312 on the waitlist</Eyebrow>
          </div>

          <h1 className="mb-10 [font-family:var(--font-serif)] text-[clamp(56px,9vw,124px)] leading-[0.96] font-normal tracking-[-0.04em] [animation:fadeUp_0.8s_0.1s_ease_both] [&_em]:text-[var(--accent)] [&_em]:italic">
            Your wallet,
            <br />
            in <em>plain English.</em>
          </h1>

          <p className="mb-11 max-w-[600px] text-[22px] leading-[1.55] font-normal text-[var(--text-secondary)] [animation:fadeUp_0.8s_0.2s_ease_both]">
            Praxis is a conversational agent for Solana. Send, swap, and
            research on-chain by writing what you want — not by hunting through
            menus, gas calculators, and twelve open tabs.
          </p>

          <div className="flex flex-wrap gap-3 [animation:fadeUp_0.8s_0.3s_ease_both]">
            <Button as="a" href="#" variant="primary">
              Request beta access
              <IconArrowRight size={16} />
            </Button>
            <Button as="a" href="#">
              Watch 60-second demo
              <IconPlayerPlay size={16} />
            </Button>
          </div>

          <div className="mt-16 flex flex-wrap items-center gap-6 [animation:fadeUp_0.8s_0.4s_ease_both]">
            {META_ITEMS.map(({ Icon, label }, i) => (
              <Fragment key={label}>
                {i > 0 && (
                  <span
                    aria-hidden
                    className="h-3.5 w-px bg-[var(--border-strong)]"
                  />
                )}
                <span className="flex items-center gap-2">
                  <Icon size={16} className="text-[var(--text-tertiary)]" />
                  <span className="[font-family:var(--font-mono)] text-[13px] text-[var(--text-tertiary)]">
                    {label}
                  </span>
                </span>
              </Fragment>
            ))}
          </div>
        </div>
      </Container>
    </section>
  );
}

function PulseDot() {
  return (
    <span
      aria-hidden
      className="h-1.5 w-1.5 rounded-full bg-[var(--success)] [animation:pulse_2s_infinite]"
    />
  );
}
