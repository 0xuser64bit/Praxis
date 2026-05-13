import type { ReactNode } from "react";

type ContainerNarrowProps = {
  children: ReactNode;
  className?: string;
};

export function ContainerNarrow({ children, className }: ContainerNarrowProps) {
  const base = "relative z-[2] mx-auto w-full max-w-[920px] px-8";
  return (
    <div className={className ? `${base} ${className}` : base}>{children}</div>
  );
}
