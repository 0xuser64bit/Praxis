"use client";

import { getPublicKeyOfUser } from "@/app/actions/user";
import { useSession } from "@/app/providers";
import ReadonlyInputWithCopy from "@/components/readonly-input";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { useEffect, useState } from "react";

export default function Profile() {
  const { session } = useSession();
  const { name, image: avatarImage } = session?.user || {};
  const [publicKey, setPublicKey] = useState("");
  useEffect(() => {
    getPublicKeyOfUser({ email: session?.user?.email as string }).then(
      (res) => {
        setPublicKey(res?.public_key as string);
      }
    );
  }, []);
  return (
    <div className="flex flex-col justify-center items-center mt-24">
      <div className="flex flex-col items-center">
        <Avatar className="cursor-pointer w-48 h-48">
          <AvatarImage
            src={avatarImage || "/fallback-avatar.png"}
            alt="@better-wallet"
          />
          <AvatarFallback>
            {name?.charAt(0).toUpperCase() || "B"}
          </AvatarFallback>
        </Avatar>
        <h1 className="text-2xl font-bold mt-4">{name || "Better wallet"}</h1>
        <p className="text-sm text-gray-400">
          {session?.user?.email || "betterwallet@betterwallet.com"}
        </p>
      </div>
      <div className="mt-5">
        <ReadonlyInputWithCopy value={publicKey || ""} />
      </div>
    </div>
  );
}
