import { PromptBox } from "@/components/prompt-box";
import { Message, MessageContent } from "@/components/ui/message";

export default function Home() {
  return (
    <div className="min-h-screen flex flex-col">
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <div className="flex flex-col gap-6">
            <div className="flex justify-center">
              <div className="w-full max-w-3xl">
                <Message className="justify-start">
                  <MessageContent className="break-words whitespace-pre-wrap">
                    Hello! How can I help you today?
                  </MessageContent>
                </Message>
              </div>
            </div>

            <div className="flex justify-center">
              <div className="w-full max-w-3xl">
                <div className="flex justify-end">
                  <div className="w-full max-w-2xl">
                    <Message className="justify-end">
                      <MessageContent markdown className="break-words whitespace-pre-wrap">
                        I can help with a variety of tasks: answering questions, providing
                        information, assisting with coding, generating creative content. What
                        would you like help with today?
                      </MessageContent>
                    </Message>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="sticky bottom-0 bg-background backdrop-blur-sm">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 pb-4">
          <div className="flex justify-center">
            <div className="w-full max-w-3xl">
              <PromptBox />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}