import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import db from "./prisma";
import { Keypair } from "@solana/web3.js";
import { encryptPrivateKey } from "./helper";

const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY;

export const { handlers, signIn, signOut, auth } = NextAuth({
  providers: [Google],
  callbacks: {
    async signIn({ user, account }) {
      if (account?.provider === "google") {
        if (!ENCRYPTION_KEY) {
          console.error("ENCRYPTION_KEY is not set in environment variables");
          return false;
        }
        const existingUser = await db.user.findUnique({
          where: {
            email: user.email as string,
          },
        });
        if (!existingUser) {
          const keypair = Keypair.generate();
          const encryptedPrivateKey = encryptPrivateKey(keypair.secretKey);
          await db.user.create({
            data: {
              email: user.email as string,
              private_key: encryptedPrivateKey,
              public_key: keypair.publicKey.toBase58(),
            },
          });
        }
        return true;
      }
      return false;
    },
  },
});
