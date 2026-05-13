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

export const metadata: Metadata = {
  title: "Praxis — A conversational agent for Solana",
  description:
    "Praxis is a conversational agent for Solana. Send, swap, and research on-chain by writing what you want — not by hunting through menus, gas calculators, and twelve open tabs.",
};

export default function Home() {
  return (
    <>
      <Nav />
      <Hero />
      <CommandDemo />
      <UseCases />
      <AppPreview />
      <HowItWorks />
      <Capabilities />
      <Principles />
      <TrustStrip />
      <FinalCTA />
      <Footer />
    </>
  );
}
