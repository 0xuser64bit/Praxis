import type { ReactNode } from "react";

type ContainerProps = {
  children: ReactNode;
  className?: string;
};

export function Container({ children, className }: ContainerProps) {
  const base = "relative z-[2] mx-auto w-full max-w-[1240px] px-8";
  return (
    <div className={className ? `${base} ${className}` : base}>{children}</div>
  );
}
