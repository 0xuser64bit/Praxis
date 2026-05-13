import { Button } from "@/components/praxis/Button";
import { Container } from "@/components/praxis/Container";
import { ContainerNarrow } from "@/components/praxis/ContainerNarrow";
import { Eyebrow } from "@/components/praxis/Eyebrow";

export default function LandingPage() {
  return (
    <main className="min-h-screen py-32">
      <Container>
        <div className="flex flex-col gap-8">
          <div className="flex flex-col gap-2">
            <Eyebrow>Scaffold preview</Eyebrow>
            <Eyebrow accent>Accent eyebrow</Eyebrow>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Button variant="primary">Launch app</Button>
            <Button>Read the manifesto</Button>
            <Button variant="primary" size="sm">
              Small primary
            </Button>
            <Button size="sm">Small default</Button>
            <Button as="a" href="#" variant="primary" size="sm">
              Link as button
            </Button>
          </div>
        </div>
      </Container>
      <ContainerNarrow className="mt-16">
        <p className="text-[var(--text-secondary)]">
          ContainerNarrow — 920px max-width, used for editorial sections.
        </p>
      </ContainerNarrow>
    </main>
  );
}
