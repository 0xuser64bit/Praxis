import { PublicKey } from "@solana/web3.js";
import { Connection } from "@solana/web3.js";

export const getLastXTransactions = async (
  publicKey: string,
  connection: Connection,
  limit: number
) => {
  const transactions = await connection.getSignaturesForAddress(
    new PublicKey(publicKey),
    {
      limit,
    }
  );
  return transactions;
};
