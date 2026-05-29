import { Fragment, type ReactNode } from "react";

/**
 * Minimal inline rich text: renders **bold** segments. The mock authors agent
 * copy with `**…**` emphasis; this keeps that legible without a markdown dep.
 */
export function renderRich(text: string): ReactNode {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((part, i) => {
    if (part.startsWith("**") && part.endsWith("**")) {
      return (
        <strong key={i} className="font-medium text-[var(--text-primary)]">
          {part.slice(2, -2)}
        </strong>
      );
    }
    return <Fragment key={i}>{part}</Fragment>;
  });
}
