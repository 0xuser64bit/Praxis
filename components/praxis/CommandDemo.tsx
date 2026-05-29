"use client";

import { IconLock } from "@tabler/icons-react";
import { useEffect, useState } from "react";

import { Container } from "@/components/praxis/Container";
import { TxCard } from "@/components/praxis/TxCard";

const CMD = "send 50 sol to maya";
const START_DELAY_MS = 1200;
const REVEAL_DELAY_MS = 400;
const MIN_KEY_MS = 45;
const KEY_JITTER_MS = 50;

export function CommandDemo() {
  const [typedLen, setTypedLen] = useState(0);
  const [started, setStarted] = useState(false);
  const [done, setDone] = useState(false);
  const [revealed, setRevealed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const timeouts: Array<ReturnType<typeof setTimeout>> = [];
    const schedule = (fn: () => void, ms: number) => {
      const id = setTimeout(() => {
        if (!cancelled) fn();
      }, ms);
      timeouts.push(id);
    };

    schedule(() => {
      setStarted(true);
      let i = 0;
      const step = () => {
        if (cancelled) return;
        setTypedLen(i);
        if (i < CMD.length) {
          i++;
          schedule(step, MIN_KEY_MS + Math.random() * KEY_JITTER_MS);
        } else {
          setDone(true);
          schedule(() => setRevealed(true), REVEAL_DELAY_MS);
        }
      };
      step();
    }, START_DELAY_MS);

    return () => {
      cancelled = true;
      timeouts.forEach(clearTimeout);
    };
  }, []);

  const caretVisible = started && !done;

  return (
    <section className="pt-[100px] pb-[120px] max-[960px]:pb-[80px]">
      <Container>
        <div
          id="product"
          className="overflow-hidden rounded-[20px] bg-[var(--bg-card)] [animation:fadeUp_0.8s_0.5s_ease_both] [border:0.5px_solid_var(--border-strong)] [box-shadow:0_60px_120px_-40px_rgba(0,0,0,0.6),0_30px_60px_-30px_rgba(201,160,93,0.08)]"
        >
          <div className="flex items-center gap-4 bg-[var(--bg-elevated)] px-[18px] py-[14px] [border-bottom:0.5px_solid_var(--border)]">
            <div className="flex gap-[7px]">
              <span className="h-[11px] w-[11px] rounded-full bg-[#ED6A5E]" />
              <span className="h-[11px] w-[11px] rounded-full bg-[#F5BE4E]" />
              <span className="h-[11px] w-[11px] rounded-full bg-[#62C554]" />
            </div>
            <div className="flex flex-1 items-center gap-2 rounded-md bg-[var(--bg-card)] px-3.5 py-[5px] [font-family:var(--font-mono)] text-[12px] text-[var(--text-secondary)] [border:0.5px_solid_var(--border)]">
              <IconLock size={12} className="text-[var(--text-tertiary)]" />
              <span>praxis.app / c / x7q1</span>
            </div>
            <div className="flex items-center gap-2">
              <span
                aria-hidden
                className="h-1.5 w-1.5 rounded-full bg-[var(--success)] [animation:pulse_2s_infinite]"
              />
              <span className="[font-family:var(--font-mono)] text-[11px] text-[var(--text-tertiary)]">
                7xK…Bgh2 · 4.82 SOL
              </span>
            </div>
          </div>

          <div className="min-h-[380px] px-11 py-10 max-[960px]:px-6 max-[960px]:py-7">
            <div className="mb-2 [font-family:var(--font-mono)] text-[11px] tracking-[0.05em] text-[var(--text-tertiary)]">
              YOU · 2:14 PM
            </div>
            <div className="mb-8 flex items-center gap-3 [font-family:var(--font-mono)] text-[16px]">
              <span className="text-[var(--accent)]">›</span>
              <span>
                {CMD.slice(0, typedLen)}
                {caretVisible && (
                  <span className="border-r-[1.5px] border-r-[var(--text-primary)] pr-0.5 [animation:caretBlink_1s_steps(2)_infinite]">
                    {" "}
                  </span>
                )}
              </span>
            </div>

            <div
              className={`[transition:opacity_0.5s_ease] ${revealed ? "opacity-100" : "opacity-0"}`}
              aria-hidden={!revealed}
            >
              <div className="mb-2 [font-family:var(--font-mono)] text-[11px] tracking-[0.05em] text-[var(--text-tertiary)]">
                PRAXIS · 2:14 PM
              </div>
              <div className="mb-4 text-[14px] leading-[1.6] text-[var(--text-secondary)] [&_strong]:font-medium [&_strong]:text-[var(--text-primary)]">
                Resolved <strong>Maya Patel</strong>, then checked the request
                against the live Aegis policy before signing.
              </div>

              <TxCard
                status={{ label: "Blocked by Aegis", dotColor: "var(--danger)" }}
                from={{
                  label: "Send",
                  primary: "50.00",
                  unit: "SOL",
                  sub: "exceeds daily envelope",
                }}
                to={{
                  label: "To",
                  primary: "Maya Patel",
                  sub: "9bLm…K3pQ",
                  compact: true,
                }}
                meta={[
                  { label: "Network fee", value: "~$0.00012" },
                  { label: "Simulation", value: "Rejected by Aegis" },
                  { label: "Policy reason", value: "Exceeds remaining 5 SOL daily cap" },
                ]}
                actions={[]}
              />
            </div>
          </div>
        </div>
      </Container>
    </section>
  );
}
