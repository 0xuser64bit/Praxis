type ThreadProps = {
  label: string;
  active?: boolean;
};

export function Thread({ label, active = false }: ThreadProps) {
  const activeClasses = active
    ? "bg-[var(--bg-card)] text-[var(--text-primary)]"
    : "text-[var(--text-secondary)] hover:bg-[var(--bg-card)] hover:text-[var(--text-primary)]";

  return (
    <button
      type="button"
      className={`mb-px w-full cursor-pointer truncate rounded-md px-2.5 py-[7px] text-left text-[13px] [transition:background_0.15s,color_0.15s] ${activeClasses}`}
    >
      {label}
    </button>
  );
}
