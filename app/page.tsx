import type { Metadata } from "next";

import { AppPreview } from "@/components/praxis/AppPreview";
import { Capabilities } from "@/components/praxis/Capabilities";
import { CommandDemo } from "@/components/praxis/CommandDemo";
import { FinalCTA } from "@/components/praxis/FinalCTA";
import { Footer } from "@/components/praxis/Footer";
import { Hero } from "@/components/praxis/Hero";
import { HowItWorks } from "@/components/praxis/HowItWorks";
import { Nav } from "@/components/praxis/Nav";
import { Principles } from "@/components/praxis/Principles";
import { TrustStrip } from "@/components/praxis/TrustStrip";
import { UseCases } from "@/components/praxis/UseCases";
import { Vision } from "@/components/praxis/Vision";
import { WhyPraxis } from "@/components/praxis/WhyPraxis";

export const metadata: Metadata = {
  title: { absolute: "Praxis — Give an agent your wallet, not your trust" },
  description:
    "Praxis is a conversational agent for Solana with an on-chain policy envelope. Delegate signing power without delegating trust — every action is checked against caps and allow-lists you control, and you can revoke it in one transaction.",
};

export default function Home() {
  return (
    <>
      <Nav />
      <Hero />
      <CommandDemo />
      <WhyPraxis />
      <UseCases />
      <AppPreview />
      <HowItWorks />
      <Capabilities />
      <Principles />
      <Vision />
      <TrustStrip />
      <FinalCTA />
      <Footer />
    </>
  );
}
