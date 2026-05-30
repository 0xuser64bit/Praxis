import { IconChevronRight, IconLock } from "@tabler/icons-react";

import { Container } from "@/components/praxis/Container";
import { Eyebrow } from "@/components/praxis/Eyebrow";
import { Receipt } from "@/components/praxis/Receipt";
import { Sidebar } from "@/components/praxis/Sidebar";
import { TxCard } from "@/components/praxis/TxCard";

export function AppPreview() {
  return (
    <section className="pt-10 pb-[140px] max-[960px]:pb-[100px]">
      <Container>
        <div className="mb-20 max-w-[720px]">
          <Eyebrow accent className="mb-5 block">
            — 02 / Inside the app
          </Eyebrow>
          <h2 className="[font-family:var(--font-serif)] text-[clamp(40px,5.5vw,72px)] leading-[1.02] tracking-[-0.03em] [&_em]:text-[var(--accent)] [&_em]:italic">
            Built for the way
            <br />
            you <em>actually</em> trade.
          </h2>
          <p className="mt-7 max-w-[540px] text-[19px] leading-[1.55] text-[var(--text-secondary)]">
            One conversation per intent. Supported actions end in a policy
            verdict before signing; unsupported routes stay blocked. No
            surprises, no hidden steps, no &ldquo;trust me.&rdquo;
          </p>
        </div>

        <div className="overflow-hidden rounded-2xl bg-[var(--bg-card)] [border:0.5px_solid_var(--border-strong)] [box-shadow:0_60px_120px_-50px_rgba(0,0,0,0.7)]">
          {/* Browser chrome */}
          <div className="flex items-center gap-4 bg-[var(--bg-elevated)] px-[18px] py-[14px] [border-bottom:0.5px_solid_var(--border)]">
            <div className="flex gap-[7px]">
              <span className="h-[11px] w-[11px] rounded-full bg-[#ED6A5E]" />
              <span className="h-[11px] w-[11px] rounded-full bg-[#F5BE4E]" />
              <span className="h-[11px] w-[11px] rounded-full bg-[#62C554]" />
            </div>
            <div className="flex flex-1 items-center gap-2 rounded-md bg-[var(--bg-card)] px-3.5 py-[5px] [font-family:var(--font-mono)] text-[12px] text-[var(--text-secondary)] [border:0.5px_solid_var(--border)]">
              <IconLock size={12} className="text-[var(--text-tertiary)]" />
              <span>praxis.app / app</span>
            </div>
          </div>

          {/* App body */}
          <div className="grid min-h-[640px] grid-cols-[240px_1fr] max-[960px]:grid-cols-1">
            <Sidebar />

            <main className="flex min-w-0 flex-col">
              {/* Thread header */}
              <header className="flex items-center justify-between px-6 py-[14px] [border-bottom:0.5px_solid_var(--border)]">
                <div className="flex items-center gap-2 text-[13px]">
                  <span className="text-[var(--text-tertiary)]">Thread</span>
                  <IconChevronRight
                    size={12}
                    className="text-[var(--text-tertiary)]"
                  />
                  <span className="font-medium">Send to Maya</span>
                </div>
                <div className="flex items-center gap-2.5">
                  <span className="inline-flex items-center gap-[7px] rounded-full bg-[var(--bg-elevated)] px-[11px] py-1 [font-family:var(--font-mono)] text-[12px] text-[var(--text-secondary)] [border:0.5px_solid_var(--border)]">
                    <span
                      aria-hidden
                      className="h-1.5 w-1.5 rounded-full bg-[var(--success)] [animation:pulse_2s_infinite]"
                    />
                    4.82 SOL
                  </span>
                  <button
                    type="button"
                    className="cursor-pointer rounded-md bg-[var(--bg-elevated)] px-[9px] py-1 [font-family:var(--font-mono)] text-[11px] text-[var(--text-tertiary)] [border:0.5px_solid_var(--border)]"
                  >
                    ⌘K
                  </button>
                </div>
              </header>

              {/* Chat */}
              <div className="min-w-0 flex-1 overflow-y-auto px-8 py-[30px]">
                {/* Earlier resolved turn */}
                <div className="mb-2">
                  <div className="mb-1.5 [font-family:var(--font-mono)] text-[11px] text-[var(--text-tertiary)]">
                    You · 2:08 PM
                  </div>
                  <div className="mb-[22px] flex items-center gap-3 [font-family:var(--font-mono)] text-[14px]">
                    <span className="text-[var(--accent)]">›</span>
                    <span>send 100 usdc to maya</span>
                  </div>
                  <Receipt meta="3vK2…X9aF · confirmed in 0.5s · slot 311,482,871">
                    Sent <strong>100.00 USDC</strong> to{" "}
                    <strong>Maya Patel</strong>
                  </Receipt>
                </div>

                {/* Divider stamp */}
                <div className="my-9 flex items-center gap-3.5 [font-family:var(--font-mono)] text-[10px] tracking-[0.14em] text-[var(--text-tertiary)] uppercase before:h-px before:flex-1 before:bg-[var(--border)] before:content-[''] after:h-px after:flex-1 after:bg-[var(--border)] after:content-['']">
                  New · 2:14 PM
                </div>

                {/* Active turn */}
                <div>
                  <div className="mb-1.5 [font-family:var(--font-mono)] text-[11px] text-[var(--text-tertiary)]">
                    You · 2:14 PM
                  </div>
                  <div className="mb-[22px] flex items-center gap-3 [font-family:var(--font-mono)] text-[14px]">
                    <span className="text-[var(--accent)]">›</span>
                    <span>send 0.5 sol to maya</span>
                  </div>

                  <div className="mb-1.5 [font-family:var(--font-mono)] text-[11px] text-[var(--text-tertiary)]">
                    Praxis · 2:14 PM
                  </div>
                  <div className="mb-4 text-[14px] leading-[1.6] text-[var(--text-secondary)] [&_strong]:font-medium [&_strong]:text-[var(--text-primary)]">
                    Found <strong>Maya Patel</strong> ·{" "}
                    <span className="[font-family:var(--font-mono)] text-[12px]">
                      9bLm…K3pQ
                    </span>{" "}
                    · 3 prior transactions, last 6 days ago.
                  </div>

                  <TxCard
                    status={{ label: "Awaiting signature" }}
                    from={{
                      label: "Send",
                      primary: "0.50",
                      unit: "SOL",
                      sub: "≈ $93.21 USD",
                    }}
                    to={{
                      label: "To",
                      primary: "Maya Patel",
                      sub: "9bLm…K3pQ",
                      compact: true,
                    }}
                    meta={[
                      { label: "Network fee", value: "~$0.00012" },
                      { label: "Simulation", value: "Will succeed", ok: true },
                      {
                        label: "After this tx",
                        value: "4.32 SOL remaining · $805.78",
                      },
                    ]}
                    actions={[
                      { label: "Confirm & sign", variant: "primary" },
                      { label: "Edit" },
                      { label: "Cancel" },
                    ]}
                  />
                </div>
              </div>

              {/* Input area */}
              <div className="bg-[var(--bg-elevated)] px-6 pt-[14px] pb-4 [border-top:0.5px_solid_var(--border)]">
                <div className="flex items-center gap-2.5 rounded-lg bg-[var(--bg-card)] px-3.5 py-2.5 [border:0.5px_solid_var(--border-strong)]">
                  <span className="[font-family:var(--font-mono)] text-[var(--accent)]">
                    ›
                  </span>
                  <span className="flex-1 [font-family:var(--font-mono)] text-[13px] text-[var(--text-primary)]">
                    send 50 sol to maya
                    <span className="border-r-[1.5px] border-r-[var(--text-primary)] [animation:caretBlink_1s_steps(2)_infinite]">
                      {" "}
                    </span>
                  </span>
                  <span className="[font-family:var(--font-mono)] text-[10px] text-[var(--text-tertiary)]">
                    ↵ to send
                  </span>
                </div>
                <div className="mt-2.5 flex items-center justify-between [font-family:var(--font-mono)] text-[10px] text-[var(--text-tertiary)]">
                  <span>⌘K commands · ⌘/ help · ⇧⏎ newline</span>
                  <span>structured intent</span>
                </div>
              </div>
            </main>
          </div>
        </div>
      </Container>
    </section>
  );
}
