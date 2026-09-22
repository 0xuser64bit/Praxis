import { IconArrowRight } from "@tabler/icons-react";

import { Button } from "@/components/praxis/Button";
import { Container } from "@/components/praxis/Container";
import { Eyebrow } from "@/components/praxis/Eyebrow";

export function FinalCTA() {
  return (
    <section className="relative pt-[180px] pb-[120px] text-center">
      <div
        aria-hidden
        className="pointer-events-none absolute top-1/2 left-1/2 z-0 h-[600px] w-[800px] -translate-x-1/2 -translate-y-1/2 [background:radial-gradient(ellipse_at_center,rgba(201,160,93,0.08),transparent_60%)]"
      />
      <Container narrow className="relative z-10">
        <Eyebrow accent className="mb-6 block">
          — Live on devnet
        </Eyebrow>
        <h2 className="mx-auto max-w-[700px] [font-family:var(--font-serif)] text-[clamp(40px,5.5vw,72px)] leading-[1.02] tracking-[-0.03em] [&_em]:text-[var(--accent)] [&_em]:italic">
          Stop clicking.
          <br />
          Start <em>typing.</em>
        </h2>
        <p className="mx-auto mt-8 mb-11 max-w-[560px] text-[19px] leading-[1.55] text-[var(--text-secondary)]">
          Connect a wallet, set your caps, and walk the whole thing: send SOL,
          move a token, schedule a recurring buy — then ask for more than your
          limit and watch the program refuse it. Devnet SOL, real enforcement.
        </p>
        <div className="flex flex-wrap justify-center gap-3">
          <Button as="a" href="/app" variant="primary">
            Launch app
            <IconArrowRight size={16} />
          </Button>
          <Button as="a" href="#principles">
            Read the principles
          </Button>
        </div>
      </Container>
    </section>
  );
}
