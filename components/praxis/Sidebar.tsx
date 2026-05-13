import { IconPlus, IconSettings } from "@tabler/icons-react";

import { Thread } from "@/components/praxis/Thread";
import { THREAD_GROUPS } from "@/data/threads";

export function Sidebar() {
  return (
    <aside className="flex flex-col bg-[var(--bg-elevated)] px-3.5 py-[18px] [border-right:0.5px_solid_var(--border)] max-[960px]:hidden">
      <div className="mb-[18px] flex items-center gap-2 px-1.5 py-1">
        <span className="flex h-[22px] w-[22px] items-center justify-center rounded-md bg-[var(--text-primary)] [font-family:var(--font-mono)] text-[12px] font-medium text-[var(--bg)]">
          P
        </span>
        <span className="[font-family:var(--font-serif)] text-[18px]">
          Praxis
        </span>
        <span className="ml-auto [font-family:var(--font-mono)] text-[10px] text-[var(--text-tertiary)]">
          v0.1
        </span>
      </div>

      <button
        type="button"
        className="mb-6 flex cursor-pointer items-center gap-2.5 rounded-lg px-3 py-[9px] text-[13px] text-[var(--text-primary)] [border:0.5px_solid_var(--border-strong)] [transition:background_0.15s] hover:bg-[var(--bg-card)]"
      >
        <IconPlus size={14} />
        New thread
        <span className="ml-auto [font-family:var(--font-mono)] text-[10px] text-[var(--text-tertiary)]">
          ⌘N
        </span>
      </button>

      {THREAD_GROUPS.map((group, idx) => (
        <div key={group.label}>
          <div
            className={`px-1.5 pb-2 [font-family:var(--font-mono)] text-[10px] tracking-[0.1em] text-[var(--text-tertiary)] uppercase ${
              idx === 0 ? "pt-0" : "pt-3.5"
            }`}
          >
            {group.label}
          </div>
          {group.items.map((item) => (
            <Thread key={item.label} label={item.label} active={item.active} />
          ))}
        </div>
      ))}

      <div className="mt-auto flex items-center gap-2.5 px-1.5 pt-4 pb-0.5 [border-top:0.5px_solid_var(--border)]">
        <div className="flex h-[30px] w-[30px] items-center justify-center rounded-full bg-[var(--bg-card)] [font-family:var(--font-mono)] text-[11px] text-[var(--text-primary)] [border:0.5px_solid_var(--border-strong)]">
          7x
        </div>
        <div className="min-w-0 flex-1">
          <div className="[font-family:var(--font-mono)] text-[11px] text-[var(--text-tertiary)]">
            7xK…Bgh2
          </div>
          <div className="text-[13px] font-medium text-[var(--text-primary)]">
            $901.23
          </div>
        </div>
        <button
          type="button"
          aria-label="Settings"
          className="cursor-pointer text-[var(--text-tertiary)]"
        >
          <IconSettings size={16} />
        </button>
      </div>
    </aside>
  );
}
