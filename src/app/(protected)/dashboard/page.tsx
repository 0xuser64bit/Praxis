"use client";

import ChatBox from "@/components/chat/chat-box";

export default function Dashboard() {
  return (
    <main className="flex flex-col items-center justify-center gap-4 py-4">
      <h1 className="text-4xl font-bold">Welcome to Dashboard</h1>
      <ChatBox />
    </main>
  );
}
