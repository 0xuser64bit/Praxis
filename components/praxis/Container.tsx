import type { ReactNode } from "react";

type ContainerProps = {
  children: ReactNode;
  className?: string;
  narrow?: boolean;
};

export function Container({ children, className, narrow }: ContainerProps) {
  const base = `relative z-[2] mx-auto w-full ${narrow ? "max-w-[920px]" : "max-w-[1240px]"} px-8 max-[960px]:px-6`;
  return (
    <div className={className ? `${base} ${className}` : base}>{children}</div>
  );
}
