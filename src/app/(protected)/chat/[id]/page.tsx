"use client";

import { getChatSessions } from "@/app/actions/chat";
import { useSession } from "@/app/providers";
import ChatBox from "@/components/chat/chat-box";
import { AnimatePresence, motion } from "framer-motion";
import { Bot, Circle, User } from "lucide-react";
import { useParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import "./local.css";

interface Message {
  id: string;
  content: string;
  role: string;
  created_at: Date;
}
export default function Chat() {
  const { id } = useParams();
  const messageRef = useRef<HTMLDivElement>(null);
  const [isTyping, setIsTyping] = useState(false);
  const [messages, setMessages] = useState<Message[] | undefined>([]);
  const { session } = useSession();
  const refreshMessages = () => {
    getChatSessions({
      email: session?.user?.email as string,
      chat_session_id: id?.toString()!,
    }).then((res) => {
      setMessages(res);
    });
  };
  useEffect(() => {
    refreshMessages();
  }, []);
  useEffect(() => {
    if (messageRef.current) {
      messageRef.current.scrollIntoView({ behavior: "smooth" });
    }
    localStorage.setItem("messages", JSON.stringify(messages));
  }, [messages]);
  if (messages?.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center pt-32">
        <Circle className="w-12 h-12 animate-spin text-gray-400" />
      </div>
    );
  }

  return (
    <div>
      <div className="p-4 space-y-4 overflow-y-auto max-h-[calc(100vh-300px)]">
        <AnimatePresence>
          {messages?.map((message) => (
            <div key={message.id} ref={messageRef}>
              <motion.div
                key={message.id}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                className={`flex items-start gap-3 break-words ${
                  message.role === "USER" ? "flex-row-reverse" : ""
                }`}
              >
                <div
                  className={`p-2 rounded-full ${
                    message.role === "USER"
                      ? "bg-purple-500/20"
                      : "bg-blue-500/20"
                  }`}
                >
                  {message.role === "USER" ? (
                    <User className="w-4 h-4 text-white" />
                  ) : (
                    <Bot className="w-4 h-4 text-white" />
                  )}
                </div>
                <motion.div
                  initial={{ scale: 0.95 }}
                  animate={{ scale: 1 }}
                  className={`rounded-lg p-3 max-w-[80%] ${
                    message.role === "USER"
                      ? "bg-purple-500/20 text-purple-50"
                      : "bg-blue-500/20 text-blue-50"
                  }`}
                >
                  <Markdown
                    rehypePlugins={[remarkGfm]}
                    components={{
                      a: ({ node, ...props }) => (
                        <a
                          {...props}
                          className="text-blue-300 underline hover:text-blue-400"
                          target="_blank"
                          rel="noopener noreferrer"
                        />
                      ),
                    }}
                  >
                    {message.content}
                  </Markdown>
                </motion.div>
              </motion.div>
            </div>
          ))}
        </AnimatePresence>
        {isTyping && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex items-center gap-2 text-gray-400"
          >
            <Bot className="w-4 h-4" />
            <div className="flex gap-1">
              <motion.div
                animate={{ y: [0, -5, 0] }}
                transition={{ duration: 0.5, repeat: Infinity, delay: 0 }}
                className="w-1 h-1 bg-gray-400 rounded-full"
              />
              <motion.div
                animate={{ y: [0, -5, 0] }}
                transition={{ duration: 0.5, repeat: Infinity, delay: 0.2 }}
                className="w-1 h-1 bg-gray-400 rounded-full"
              />
              <motion.div
                animate={{ y: [0, -5, 0] }}
                transition={{ duration: 0.5, repeat: Infinity, delay: 0.4 }}
                className="w-1 h-1 bg-gray-400 rounded-full"
              />
            </div>
          </motion.div>
        )}
      </div>
      <ChatBox onMessageSent={refreshMessages} />
    </div>
  );
}
