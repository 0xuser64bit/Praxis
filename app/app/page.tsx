import type { Metadata } from "next";

import { PraxisApp } from "@/components/app/PraxisApp";

export const metadata: Metadata = {
  title: "Praxis — App",
  description:
    "The Praxis product app: a conversational Solana agent whose spending envelope is enforced on-chain by Aegis. Propose, preview the policy verdict, sign — or watch the chain say no.",
};

export default function AppPage() {
  return <PraxisApp />;
}
