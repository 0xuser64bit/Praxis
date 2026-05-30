import { Container } from "@/components/praxis/Container";
import { Eyebrow } from "@/components/praxis/Eyebrow";
import { USE_CASES, type UseCase } from "@/data/usecases";

export function UseCases() {
  return (
    <section className="py-[140px] max-[960px]:py-[100px]">
      <Container>
        <div className="mb-20 max-w-[720px]">
          <Eyebrow accent className="mb-5 block">
            — 01 / Use cases
          </Eyebrow>
          <h2 className="[font-family:var(--font-serif)] text-[clamp(40px,5.5vw,72px)] leading-[1.02] tracking-[-0.03em] [&_em]:text-[var(--accent)] [&_em]:italic">
            Just <em>say it.</em>
          </h2>
          <p className="mt-7 max-w-[540px] text-[19px] leading-[1.55] text-[var(--text-secondary)]">
            Praxis is built around one input field. Whatever you&apos;d do on
            Solana, you can ask for in a sentence — and Praxis turns supported
            intents into signable actions, while blocking anything it cannot
            enforce.
          </p>
        </div>

        <div className="grid grid-cols-2 gap-px overflow-hidden rounded-2xl bg-[var(--border)] [border:0.5px_solid_var(--border)] max-[960px]:grid-cols-1">
          {USE_CASES.map((uc) => (
            <UseCaseTile key={uc.title.accent} {...uc} />
          ))}
        </div>
      </Container>
    </section>
  );
}

function UseCaseTile({
  icon: Icon,
  prompt,
  title,
  description,
  tag,
}: UseCase) {
  return (
    <div className="bg-[var(--bg)] px-8 py-9 [transition:background_0.2s_ease] hover:bg-[var(--bg-elevated)]">
      <div className="mb-[22px] flex h-9 w-9 items-center justify-center rounded-lg bg-[var(--bg-elevated)] text-[var(--accent)] [border:0.5px_solid_var(--border)]">
        <Icon size={18} />
      </div>
      <div className="mb-[18px] flex items-center gap-2 rounded-md bg-[var(--bg-elevated)] px-3 py-[9px] [font-family:var(--font-mono)] text-[13px] text-[var(--text-secondary)] [border:0.5px_solid_var(--border)]">
        <span className="text-[var(--accent)]">›</span>
        <span>{prompt}</span>
      </div>
      <h3 className="mb-2.5 [font-family:var(--font-serif)] text-[22px] leading-[1.15] tracking-[-0.015em] [&_em]:text-[var(--accent)] [&_em]:italic">
        {title.lead}
        <em>{title.accent}</em>
      </h3>
      <p className="text-[14px] leading-[1.55] text-[var(--text-secondary)]">
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
