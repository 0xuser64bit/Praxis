import { IconArrowRight } from "@tabler/icons-react";

import { Button } from "@/components/praxis/Button";
import { ContainerNarrow } from "@/components/praxis/ContainerNarrow";
import { Eyebrow } from "@/components/praxis/Eyebrow";

export function FinalCTA() {
  return (
    <section className="relative pt-[180px] pb-[120px] text-center">
      <div
        aria-hidden
        className="pointer-events-none absolute top-1/2 left-1/2 z-0 h-[600px] w-[800px] -translate-x-1/2 -translate-y-1/2 [background:radial-gradient(ellipse_at_center,rgba(201,160,93,0.08),transparent_60%)]"
      />
      <ContainerNarrow className="relative z-10">
        <Eyebrow accent className="mb-6 block">
          — Beta
        </Eyebrow>
        <h2 className="mx-auto max-w-[700px] [font-family:var(--font-serif)] text-[clamp(40px,5.5vw,72px)] leading-[1.02] tracking-[-0.03em] [&_em]:text-[var(--accent)] [&_em]:italic">
          Stop clicking.
          <br />
          Start <em>typing.</em>
        </h2>
        <p className="mx-auto mt-8 mb-11 max-w-[540px] text-[19px] leading-[1.55] text-[var(--text-secondary)]">
          Walk the core flow: ask for a SOL send, preview the Aegis verdict,
          confirm an allowed transfer, reject an over-limit request, and revoke
          the agent key.
        </p>
        <div className="flex flex-wrap justify-center gap-3">
          <Button as="a" href="/app" variant="primary">
            Launch demo app
            <IconArrowRight size={16} />
          </Button>
          <Button as="a" href="#principles">
            Read the principles
          </Button>
        </div>
      </ContainerNarrow>
    </section>
  );
}
