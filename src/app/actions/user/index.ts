"use server";

import { signIn, signOut } from "@/app/lib/auth";
import db from "@/app/lib/prisma";

export async function handleSignIn() {
  await signIn("google", { redirectTo: "/dashboard" });
}

export async function handleSignOut() {
  await signOut({ redirectTo: "/" });
}

export async function getPublicKeyOfUser({ email }: { email: string }) {
  const public_key = await db.user.findFirst({
    where: {
      email,
    },
    select: {
      public_key: true,
    },
  });
  return public_key;
}
