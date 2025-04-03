"use client";

import { handleSignIn } from "@/app/actions/user";
import { useSession } from "@/app/providers";
import { Coins, User, Zap } from "lucide-react";
import { useTransition } from "react";
import UserAccountDropdown from "./user-account-dropdown";

export const Header = () => {
  const [isPending, startTransition] = useTransition();
  const { session, loading } = useSession();

  return (
    <div className="flex justify-between items-center mb-8">
      <div className="flex items-center">
        <Zap className="w-8 h-8 mr-3 text-emerald-400" />
        <h1 className="text-2xl font-bold tracking-wide">Better Wallet</h1>
      </div>
      <div className="flex items-center space-x-2">
        {loading ? (
          <div className="bg-gray-800 rounded-full px-4 py-2 animate-pulse h-10 w-32" />
        ) : session?.user ? (
          <div className="flex gap-x-2 items-center">
            <div className="bg-gray-800 rounded-full px-4 py-2 flex items-center">
              <Coins className="mr-2 text-emerald-400" />
              <span className="font-semibold">${"234.00"}</span>
            </div>
            <UserAccountDropdown
              avatarImage={session.user.image as string}
              name={session.user.name as string}
            />
          </div>
        ) : (
          <div
            role="button"
            onClick={() => startTransition(() => handleSignIn())}
            className={`cursor-pointer bg-gray-800 rounded-full px-4 py-2 flex items-center ${
              isPending ? "opacity-70" : ""
            }`}
          >
            <User className="mr-2 text-emerald-400" />
            <span className="font-semibold">Sign in</span>
          </div>
        )}
      </div>
    </div>
  );
};
