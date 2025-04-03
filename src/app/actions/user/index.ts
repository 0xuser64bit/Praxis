"use server";

import { signIn, signOut } from "@/app/lib/auth";

export async function handleSignIn() {
  await signIn("google", { redirectTo: "/dashboard" });
}

export async function handleSignOut() {
  await signOut({ redirectTo: "/" });
}
