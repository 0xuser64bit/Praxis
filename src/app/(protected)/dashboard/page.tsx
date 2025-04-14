"use client";

import ChatBox from "@/components/chat/chat-box";
import UserData from "@/components/user-data";

export default function Dashboard() {
  return (
    <main className="flex flex-col items-center justify-center gap-4 py-4">
      <UserData />
      <ChatBox />
    </main>
  );
}
