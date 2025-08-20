import { PromptBox } from "@/components/prompt-box";

export default function Home() {
  return (
    <div className="min-h-screen">
      <div className="w-full flex justify-center border">
        Everything is awesome
      </div>
      <div className="sticky top-[100vh] flex justify-center">
        <PromptBox />
      </div>
    </div>
  );
}
