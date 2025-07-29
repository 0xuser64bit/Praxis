import { ArrowUp } from 'lucide-react';
import { useEffect, useRef, useState } from "react";

interface ChatInputProps {
  onSendMessage: (message: string) => void;
  placeholder?: string;
  disabled?: boolean;
  maxRows?: number;
  className?: string;
}

export const ChatBox = ({
  onSendMessage,
  placeholder = "Message Better-Wallet",
  disabled = false,
  maxRows = 5,
  className = ""
}: ChatInputProps) => {
  const [message, setMessage] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-resize textarea
  useEffect(() => {
    const textarea = textareaRef.current;
    if (textarea) {
      textarea.style.height = 'auto';
      const scrollHeight = textarea.scrollHeight;
      const lineHeight = 24; // Approximate line height
      const maxHeight = lineHeight * maxRows;

      textarea.style.height = `${Math.min(scrollHeight, maxHeight)}px`;
    }
  }, [message, maxRows]);

  const handleSubmit = () => {
    if (message.trim() && !disabled) {
      onSendMessage(message.trim());
      setMessage('');
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const canSend = message.trim().length > 0 && !disabled;

  return (
    <div className={`w-full max-w-4xl mx-auto ${className}`}>
      <div className="relative">
        <div className="relative flex items-end bg-[#303030] rounded-2xl shadow-sm hover:shadow-md transition-shadow duration-200 focus-within:shadow-md focus-within:border-gray-400">
          <textarea
            value={message}
            ref={textareaRef}
            onChange={(e) => setMessage(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={placeholder}
            disabled={disabled}
            rows={1}
            className="flex-1 resize-none bg-transparent px-5 py-3 text-white placeholder-gray-500 border-none outline-none min-h-[48px] max-h-32 overflow-y-auto text-sm"
            style={{ lineHeight: '24px' }}
          />

          <button
            onClick={handleSubmit}
            disabled={!canSend}
            className={`p-2 m-2 rounded-lg transition-all duration-200 ${canSend
              ? 'bg-white text-black shadow-sm hover:shadow-md'
              : 'invisible'
              }`}
          >
            <ArrowUp size={18} />
          </button>
        </div>

        <div className="flex justify-center items-center mt-2 px-2 text-xs text-gray-500">
          <span>Press Enter to send, Shift+Enter for new line</span>
        </div>
      </div>
    </div>
  )
}
