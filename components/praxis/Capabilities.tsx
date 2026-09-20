import { Container } from "@/components/praxis/Container";
import { Eyebrow } from "@/components/praxis/Eyebrow";
import { CAPABILITIES, type Capability } from "@/data/capabilities";

export function Capabilities() {
  return (
    <section className="pt-[60px] pb-[140px] max-[960px]:pb-[100px]">
      <Container>
        <div className="mb-20 max-w-[720px]">
          <Eyebrow accent className="mb-5 block">
            — 04 / Capabilities
          </Eyebrow>
          <h2 className="[font-family:var(--font-serif)] text-[clamp(40px,5.5vw,72px)] leading-[1.02] tracking-[-0.03em] [&_em]:text-[var(--accent)] [&_em]:italic">
            What&apos;s under
            <br />
            the <em>hood.</em>
          </h2>
        </div>

        <div className="grid grid-cols-3 gap-px overflow-hidden rounded-2xl bg-[var(--border)] [border:0.5px_solid_var(--border)] max-[960px]:grid-cols-1">
          {CAPABILITIES.map((cap) => (
            <CapabilityCard key={cap.title} {...cap} />
          ))}
        </div>
      </Container>
    </section>
  );
}

function CapabilityCard({ icon: Icon, title, description, tag }: Capability) {
  return (
    <div className="flex min-h-[240px] flex-col bg-[var(--bg)] px-8 py-10 [transition:background_0.2s] hover:bg-[var(--bg-elevated)]">
      <div className="mb-6 text-[var(--accent)]">
        <Icon size={22} />
      </div>
      <h3 className="mb-3 [font-family:var(--font-serif)] text-[24px] tracking-[-0.015em]">
        {title}
      </h3>
      <p className="flex-1 text-[14px] leading-[1.55] text-[var(--text-secondary)]">
        {description}
      </p>
      {tag && (
        <div className="mt-4 [font-family:var(--font-mono)] text-[10px] tracking-[0.12em] text-[var(--accent)] uppercase">
          {tag}
        </div>
      )}
    </div>
  );
}
