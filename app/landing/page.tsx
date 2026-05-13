import { AppPreview } from "@/components/praxis/AppPreview";
import { Capabilities } from "@/components/praxis/Capabilities";
import { CommandDemo } from "@/components/praxis/CommandDemo";
import { Hero } from "@/components/praxis/Hero";
import { HowItWorks } from "@/components/praxis/HowItWorks";
import { Nav } from "@/components/praxis/Nav";
import { UseCases } from "@/components/praxis/UseCases";

export default function LandingPage() {
  return (
    <>
      <Nav />
      <Hero />
      <CommandDemo />
      <UseCases />
      <AppPreview />
      <HowItWorks />
      <Capabilities />
    </>
  );
}
