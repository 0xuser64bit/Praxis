"use client";

import { Header } from "@/components/header";
import { motion } from "framer-motion";
import {
  Coins,
  CreditCard,
  FileText,
  Send,
  Settings,
  Wallet,
} from "lucide-react";

const cardData = [
  {
    icon: <Wallet className="w-6 h-6 text-emerald-400" />,
    title: "Manage Wallet",
    description: "View balance, addresses and assets",
  },
  {
    icon: <Send className="w-6 h-6 text-blue-400" />,
    title: "Send & Receive",
    description: "Transfer tokens with natural language",
  },
  {
    icon: <FileText className="w-6 h-6 text-violet-400" />,
    title: "Transaction History",
    description: "Review your past activities",
  },
  {
    icon: <CreditCard className="w-6 h-6 text-yellow-400" />,
    title: "Buy & Sell",
    description: "Trade cryptocurrencies easily",
  },
  {
    icon: <Coins className="w-6 h-6 text-red-400" />,
    title: "Stake & Earn",
    description: "Grow your assets with staking",
  },
  {
    icon: <Settings className="w-6 h-6 text-gray-400" />,
    title: "Customize",
    description: "Personalize your wallet experience",
  },
];

export default function Home() {
  const container = {
    hidden: { opacity: 0 },
    show: {
      opacity: 1,
      transition: {
        staggerChildren: 0.1,
      },
    },
  };

  const item = {
    hidden: { y: 20, opacity: 0 },
    show: { y: 0, opacity: 1 },
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-gray-900 to-black text-white">
      <div className="container mx-auto max-w-6xl p-4">
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
        >
          <Header />
        </motion.div>

        <main className="flex flex-col items-center justify-center py-10">
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.5 }}
            className="text-center mb-12"
          >
            <h1 className="text-5xl font-bold mb-4 bg-gradient-to-r from-emerald-400 to-blue-500 text-transparent bg-clip-text">
              Your AI-Powered Solana Wallet
            </h1>
            <p className="text-xl text-gray-300 max-w-2xl mx-auto">
              Manage your crypto with simple voice commands. Just tell us what
              you want to do.
            </p>
          </motion.div>

          <motion.div
            variants={container}
            initial="hidden"
            animate="show"
            className="grid grid-cols-1 md:grid-cols-3 gap-6 w-full max-w-6xl mb-16"
          >
            {cardData.map((feature, index) => (
              <motion.div
                key={index}
                variants={item}
                className="bg-gray-800 bg-opacity-60 backdrop-blur-sm p-8 rounded-xl border border-gray-700 hover:border-emerald-400/50 transition-all"
              >
                <div className="bg-gray-700 rounded-full w-12 h-12 flex items-center justify-center mb-4">
                  {feature.icon}
                </div>
                <h3 className="text-lg font-semibold mb-2">{feature.title}</h3>
                <p className="text-gray-400">{feature.description}</p>
              </motion.div>
            ))}
          </motion.div>
        </main>
      </div>
    </div>
  );
}
