import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export default function ReadonlyInputWithCopy({
  value = "Default readonly value",
  className,
  inputClassName,
  buttonClassName,
  ...props
}: {
  value?: string;
  className?: string;
  inputClassName?: string;
  buttonClassName?: string;
}) {
  const [isCopied, setIsCopied] = useState(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(value);
    setIsCopied(true);
    setTimeout(() => setIsCopied(false), 2000);
  };

  return (
    <div className={cn("flex w-full items-center space-x-2", className)}>
      <div className="relative w-full">
        <Input
          readOnly
          value={value}
          className={cn("pr-10 bg-gray-300/30 border-0", inputClassName)}
          {...props}
        />
      </div>
      <Button
        size="icon"
        onClick={handleCopy}
        className={cn("flex-shrink-0 cursor-pointer", buttonClassName)}
        aria-label="Copy to clipboard"
      >
        {isCopied ? (
          <Check className="h-4 w-4 text-green-500" />
        ) : (
          <Copy className="h-4 w-4" />
        )}
      </Button>
    </div>
  );
}
