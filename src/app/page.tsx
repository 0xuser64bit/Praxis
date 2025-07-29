"use client";

import { ChatBox } from "@/components/chat-box";
import { useState } from "react";

export default function Home() {
  // Todo: message will be fetched from the server if there are any
  const [messages, setMessages] = useState<string[]>([]);
  const handleSendMessage = (message: string) => {
    setMessages(prev => [...prev, message]);
    console.log('Message sent:', message);
  };

  return (
    <div className="min-h-screen bg-[#212020]">
      <div className="flex flex-col items-center justify-center h-screen">
        <ChatBox onSendMessage={handleSendMessage} />
      </div>
    </div>
  );
}
