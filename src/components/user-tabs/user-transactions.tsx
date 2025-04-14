"use client";

import { getPublicKeyOfUser } from "@/app/actions/user";
import { getLastXTransactions } from "@/utils/helpter";
import { Connection } from "@solana/web3.js";
import { motion } from "framer-motion";
import { Check, ExternalLink, Repeat } from "lucide-react";
import { useEffect, useState } from "react";

export default function UserTransactions({ email }: { email: string }) {
  const [transactions, setTransactions] = useState<any[]>([]);
  const [publicKey, setPublicKey] = useState("");
  const connection = new Connection(
    process.env.SOLANA_CLUSTER_URL || "https://api.devnet.solana.com"
  );
  const getUserBalanceAndTransactions = async () => {
    if (!publicKey) return;
    const transactions = await getLastXTransactions(publicKey, connection, 5);
    setTransactions(transactions);
    console.log("transactions", transactions);
  };

  useEffect(() => {
    getPublicKeyOfUser({ email }).then((res) => {
      setPublicKey(res?.public_key as string);
    });
  }, []);

  useEffect(() => {
    getUserBalanceAndTransactions();
  }, [publicKey, transactions]);
  return (
    <div className="space-y-2 mt-3">
      {transactions.map((tx) => (
        <motion.div
          key={tx.signature}
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex items-center justify-between p-5 rounded-lg backdrop-blur-xl bg-white/5 hover:bg-white/10 transition-colors"
        >
          <div className="flex items-center gap-3">
            <div>
              <Repeat className="w-4 h-4 mr-2 transform rotate-90" />
            </div>
            <div className="text-sm text-gray-400">
              {tx.signature.slice(0, 8) + "..." + tx.signature.slice(-8)}
            </div>
            <div>
              <Check
                className={`w-4 h-4 mr-2 ${
                  tx.confirmationStatus === "finalized"
                    ? "text-green-400"
                    : "text-yellow-400"
                }`}
              />
            </div>
          </div>
          <div className="text-right">
            <div className="font-medium">{tx.amount}</div>
            <div className="text-sm text-gray-400">
              {new Date(tx.blockTime * 1000).toDateString() +
                " " +
                new Date(tx.blockTime * 1000).toLocaleTimeString()}
            </div>
            <ExternalLink
              className="w-5 h-5 text-gray-400 float-end clear-both my-2 cursor-pointer hover:opacity-80"
              onClick={() =>
                window.open(
                  `https://solscan.io/tx/${tx.signature}?cluster=devnet`,
                  "_blank"
                )
              }
            />
          </div>
        </motion.div>
      ))}
      {transactions.length === 0 && (
        <div className="flex flex-col items-center justify-center gap-4 py-4">
          <div className="w-full h-full flex items-center justify-center text-xl font-bold">
            No transactions found
          </div>
        </div>
      )}
    </div>
  );
}
