import { Circle, Send, Zap } from "lucide-react";
import { useState } from "react";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { sendMessageAction } from "@/app/actions/chat";
import { useRouter } from "next/navigation";

export default function ChatBox() {
  const [inputValue, setInputValue] = useState("");
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(false);

  const handleSendMessage = async () => {
    const url = window.location.href;
    setIsLoading(true);
    if (url.includes("/dashboard")) {
      const { success, chat_session_id } = await sendMessageAction({
        content: inputValue,
        role: "USER",
      });
      if (!success) {
        setIsLoading(false);
        alert("Failed to send message new");
        return;
      }
      router.push(`/chat/${chat_session_id}`);
    } else if (url.includes("/chat")) {
      const { success } = await sendMessageAction({
        chat_session_id: url.split("/chat/")[1],
        content: inputValue,
        role: "ASSISTANT",
      });
      if (!success) {
        setIsLoading(false);
        alert("Failed to send message");
        return;
      }
    }
    setIsLoading(false);
    setInputValue("");
  };

  return (
    <div className="fixed bottom-0 left-0 right-0 p-4">
      <div className="max-w-4xl mx-auto relative">
        <Input
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          placeholder="Describe your crypto action in natural language..."
          className="w-full p-6 px-12 bg-gray-800 rounded-2xl text-white placeholder-gray-500 "
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              handleSendMessage();
            }
          }}
        />
        <Zap className="absolute left-4 top-1/2 -translate-y-1/2 text-emerald-400" />
        <Button
          className="cursor-pointer absolute right-2 top-1/2 -translate-y-1/2 bg-emerald-600 text-white p-2 rounded-full hover:bg-emerald-500 transition"
          disabled={inputValue.length === 0}
          onClick={handleSendMessage}
        >
          {isLoading ? (
            <Circle className="animate-spin" />
          ) : (
            <Send className="h-5 w-5" />
          )}
        </Button>
      </div>
    </div>
  );
}
