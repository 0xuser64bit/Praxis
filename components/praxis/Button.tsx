import type { ComponentPropsWithoutRef, ElementType, ReactNode } from "react";

type ButtonOwnProps = {
  variant?: "primary" | "default";
  size?: "sm" | "default";
  className?: string;
  children: ReactNode;
};

export type ButtonProps<E extends ElementType = "button"> = ButtonOwnProps &
  Omit<ComponentPropsWithoutRef<E>, keyof ButtonOwnProps | "as"> & {
    as?: E;
  };

export function Button<E extends ElementType = "button">({
  as,
  variant = "default",
  size = "default",
  className,
  children,
  ...rest
}: ButtonProps<E>) {
  const Component = (as ?? "button") as ElementType;

  const base =
    "inline-flex cursor-pointer items-center gap-2 rounded-lg font-medium tracking-[-0.005em] [transition:all_0.2s_ease]";

  const sizeClasses =
    size === "sm" ? "px-3.5 py-2 text-[13px]" : "px-5 py-3 text-[14px]";

  const variantClasses =
    variant === "primary"
      ? "[border:0.5px_solid_var(--text-primary)] bg-[var(--text-primary)] text-[var(--bg)] hover:[border-color:var(--accent)] hover:bg-[var(--accent)]"
      : "[border:0.5px_solid_var(--border-strong)] bg-transparent text-[var(--text-primary)] hover:[border-color:var(--border-bright)] hover:bg-[var(--bg-elevated)]";

  const classes = [base, sizeClasses, variantClasses, className]
    .filter(Boolean)
    .join(" ");

  return (
    <Component className={classes} {...rest}>
      {children}
    </Component>
  );
}
