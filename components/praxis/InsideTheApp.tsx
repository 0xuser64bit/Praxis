"use client";

/**
 * A looping walkthrough of the product, in the product's own chrome.
 *
 * This replaces two things that each showed a slice: a one-shot typing demo
 * that played once on page load and then sat frozen for the rest of the
 * session, and a static screenshot-in-HTML of a single send. Neither said what
 * Praxis grew into — an envelope that covers SOL, SPL and Token-2022, a
 * recurring-buy scheduler, a policy you can change by asking, and an audit
 * trail. So the demo runs continuously through seven scenes and crosses all
 * three surfaces of the app.
 *
 * Every command here parses in `server/agent/intent.ts` and every number is
 * one the product would actually render. A marketing page that demonstrates a
 * phrasing the parser rejects is a support ticket with a countdown on it.
 *
 * It pauses when scrolled out of view, and `prefers-reduced-motion` gets the
 * scenes fully settled with the rail as the only way to move between them.
 */

import {
  IconCalendarRepeat,
  IconCheck,
  IconExternalLink,
  IconHistory,
  IconLock,
  IconMessages,
  IconShieldCheck,
  IconShieldLock,
  IconShieldX,
} from "@tabler/icons-react";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";

import { Thinking } from "@/components/app/Thinking";
import { Container } from "@/components/praxis/Container";
import { Eyebrow } from "@/components/praxis/Eyebrow";
import { PraxisLogoMark } from "@/components/praxis/PraxisLogo";
import { Receipt } from "@/components/praxis/Receipt";
import { TxCard } from "@/components/praxis/TxCard";
import { Verdict } from "@/components/praxis/Verdict";

type Surface = "chat" | "policy" | "activity";
type Phase = "typing" | "thinking" | "reveal" | "settled";

interface Scene {
  id: string;
  /** Rail label — how a viewer names this beat. */
  label: string;
  surface: Surface;
  /** Breadcrumb / active thread in the sidebar. */
  thread: string;
  /** Typed into the composer. Chat scenes only. */
  command?: string;
  /**
   * The turn already in this thread when the scene opens.
   *
   * Not decoration: while the command is still being typed there is nothing
   * else in the chat column, and an empty 500px panel reads as a broken
   * screenshot rather than a fresh prompt. A thread with one turn of history
   * is also just what a real one looks like.
   */
  history?: ReactNode;
  /**
   * The agent's reply. `settled` is the scene's second beat — the signature
   * landing, the schedule appearing, the refusal being spelled out. A card
   * that changes state (awaiting → confirmed) returns a different card rather
   * than stacking a second one under it, which is both what the app does and
   * what keeps the window from growing mid-scene.
   */
  reply?: (settled: boolean) => ReactNode;
  /** False for scenes that say everything in one beat. */
  twoBeats?: boolean;
  /** One line under the window saying what this scene proves. */
  caption: ReactNode;
}

const TYPE_MS = 42;
const AFTER_TYPE_MS = 280;
const THINK_MS = 720;
const REPLY_HOLD_MS = 2600;
const SETTLED_HOLD_MS = 2600;
const SURFACE_HOLD_MS = 4600;

const FEE = "0.000005 SOL ($0.00093)";

const SCENES: Scene[] = [
  {
    id: "send",
    label: "Send",
    surface: "chat",
    thread: "Send to Maya",
    command: "send 0.5 sol to maya",
    history: (
      <History command="save 9bLm…K3pQ as maya" at="2:08 PM">
        <Note tone="success">
          Saved <strong>Maya Chen</strong> to your address book. Labels resolve
          names in chat and carry no signing power of their own.
        </Note>
      </History>
    ),
    caption: (
      <>
        A name, not an address. The proposal carries the fee, the simulation and
        the verdict before there is anything to sign.
      </>
    ),
    twoBeats: true,
    reply: (settled) => (
      <>
        <Prose>
          Resolved <strong>Maya Chen</strong> from the address book.
        </Prose>
        <TxCard
          status={
            settled
              ? { label: "Confirmed", tone: "success" }
              : { label: "Awaiting signature" }
          }
          from={{ label: "Send", primary: "0.50", unit: "SOL", sub: "≈ $93.21" }}
          to={{ label: "To", primary: "Maya Chen", sub: "9bLm…K3pQ", compact: true }}
          meta={[
            { label: "Network fee", value: FEE },
            { label: "Simulation", value: "Will succeed", ok: true },
          ]}
          verdict={
            <Verdict
              allowed
              detail="5 SOL daily cap · 4.82 SOL left today · 4.32 SOL after this"
              meter={{ spent: 0.036, amount: 0.1 }}
            />
          }
          actions={[{ label: "Confirm & sign", variant: "primary" }, { label: "Cancel" }]}
          footer={
            settled ? (
              <Receipt meta="3vK2…X9aF · confirmed in 0.6s · slot 311,482,871">
                Sent <strong>0.50 SOL</strong> to <strong>Maya Chen</strong>
              </Receipt>
            ) : undefined
          }
        />
      </>
    ),
  },
  {
    id: "blocked",
    label: "Blocked",
    surface: "chat",
    thread: "Cold storage",
    command: "send 50 sol to savings",
    history: (
      <History command="what are my limits right now" at="2:11 PM">
        <p className="[&_strong]:font-medium [&_strong]:text-[var(--text-primary)]">
          Per transaction <strong>2 SOL</strong>, daily <strong>5 SOL</strong>,
          of which <strong>4.32 SOL</strong> is left in the current rolling
          window. The session key expires in 6 days.
        </p>
      </History>
    ),
    caption: (
      <>
        The whole thesis in one card. Not our server declining — the program
        refusing, with the reason code it refuses by.
      </>
    ),
    twoBeats: true,
    reply: (settled) => (
      <>
        <Prose>
          Resolved <strong>Cold storage</strong>, then checked it against the live
          Aegis policy.
        </Prose>
        <TxCard
          status={{ label: "Blocked by Aegis", tone: "danger" }}
          from={{ label: "Send", primary: "50.00", unit: "SOL", sub: "≈ $9,321.00" }}
          to={{ label: "To", primary: "Cold storage", sub: "7Hq4…Lm2V", compact: true }}
          meta={[
            { label: "Network fee", value: FEE },
            { label: "Simulation", value: "Rejected by Aegis" },
          ]}
          verdict={
            <Verdict
              allowed={false}
              detail="50 SOL exceeds the 4.32 SOL left on your rolling daily cap."
              meter={{ spent: 0.136, amount: 0.864 }}
              reasonCode="exceeds the remaining daily limit"
            />
          }
          actions={[]}
        />
        {settled && (
          <Note tone="danger">
            Nothing was submitted. The same instruction fails whether it is asked
            for by you, by the agent, by our backend, or by a jailbroken prompt.
          </Note>
        )}
      </>
    ),
  },
  {
    id: "stocks",
    label: "Pre-IPO stocks",
    surface: "chat",
    thread: "OPENAI buy",
    command: "buy $40 openai",
    history: (
      <History command="what's openai doing this week" at="2:12 PM">
        <p className="[&_strong]:font-medium [&_strong]:text-[var(--text-primary)]">
          <strong>$217.40</strong> · +4.1% over 24h · $2.1M 24h volume, from the
          live PreStocks quote. Read-only data — no buy, sell or hold advice.
        </p>
      </History>
    ),
    caption: (
      <>
        The PreStocks mints are Token-2022. Aegis calls the token program with
        TransferChecked, so mint and decimals get re-verified inside the
        instruction.
      </>
    ),
    reply: () => (
      <>
        <Prose>
          No recipient named, so this settles into your own wallet.{" "}
          <strong>OPENAI</strong> is a Token-2022 mint at 9 decimals, priced from
          the live PreStocks quote, and its envelope is separate from your SOL one.
        </Prose>
        <TxCard
          status={{ label: "Awaiting signature" }}
          from={{ label: "Send", primary: "40.00", unit: "OPENAI", sub: "≈ $8,696.00" }}
          to={{ label: "To", primary: "Your wallet", sub: "7xK…Bgh2", compact: true }}
          meta={[
            { label: "Network fee", value: FEE },
            { label: "Simulation", value: "Will succeed", ok: true },
          ]}
          verdict={
            <Verdict
              allowed
              detail="500 OPENAI daily cap · 500 OPENAI left today · 460 after this"
              meter={{ spent: 0, amount: 0.08 }}
            />
          }
          actions={[{ label: "Confirm & sign", variant: "primary" }, { label: "Cancel" }]}
        />
      </>
    ),
  },
  {
    id: "recurring",
    label: "Recurring",
    surface: "chat",
    thread: "SPACEX weekly",
    command: "buy $50 spacex every monday",
    history: (
      <History command="send 40 openai to maya" at="2:13 PM">
        <Receipt meta="5JLj…H6gr · confirmed in 0.7s · Token-2022">
          Sent <strong>40.00 OPENAI</strong> to <strong>Maya Chen</strong>
        </Receipt>
      </History>
    ),
    caption: (
      <>
        A schedule that proposes, never signs. Every fire comes back through the
        same checks and waits for you.
      </>
    ),
    twoBeats: true,
    reply: (settled) => (
      <>
        <Prose>
          <strong>SPACEX</strong> is transferable on this cluster and sits inside
          its own envelope, so the schedule can only ever propose buys the policy
          already allows.
        </Prose>
        <Note tone="success">
          Scheduled 50 SPACEX every Monday for you — I&rsquo;ll propose each buy for
          your signature. Nothing moves until you sign.
        </Note>
        {settled && (
          <div className="mt-3 flex items-center gap-3 rounded-lg bg-[var(--bg-elevated)] px-3.5 py-3 [border:0.5px_solid_var(--border)]">
        <IconCalendarRepeat size={15} className="shrink-0 text-[var(--text-tertiary)]" />
        <div className="min-w-0 flex-1">
          <div className="text-[13px] font-medium text-[var(--text-primary)]">
            50 SPACEX{" "}
            <span className="font-normal text-[var(--text-tertiary)]">· every Monday</span>
          </div>
          <div className="[font-family:var(--font-mono)] text-[10px] text-[var(--text-tertiary)]">
            for you · next in 4d
          </div>
        </div>
            <span className="shrink-0 rounded-md px-2.5 py-1 [font-family:var(--font-mono)] text-[11px] text-[var(--text-tertiary)] [border:0.5px_solid_var(--border)]">
              Stop
            </span>
          </div>
        )}
      </>
    ),
  },
  {
    id: "policy-change",
    label: "Change the caps",
    surface: "chat",
    thread: "Tighten the cap",
    command: "lower my daily cap to 2 sol",
    history: (
      <History command="is the agent paused" at="2:13 PM">
        <p className="[&_strong]:font-medium [&_strong]:text-[var(--text-primary)]">
          No — transfers are <strong>active</strong>. Pausing is one owner-signed
          transaction, and revoking zeroes the session key outright.
        </p>
      </History>
    ),
    caption: (
      <>
        The agent can propose a policy change; it cannot make one. Aegis takes
        the owner&rsquo;s signature for every knob on this card.
      </>
    ),
    reply: () => (
      <>
        <Prose>
          I&rsquo;ve prepared this policy change. Aegis requires your signature for
          any policy change — sign in your wallet to apply it.
        </Prose>
        <div className="mt-2 rounded-xl bg-[var(--bg)] px-5 py-[18px] [border:0.5px_solid_var(--border-strong)]">
          <div className="mb-3.5 flex items-center gap-2 [font-family:var(--font-mono)] text-[10px] tracking-[0.12em] text-[var(--text-tertiary)] uppercase">
            <IconShieldLock size={13} />
            Policy change
          </div>
          <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2.5 text-[13px]">
            <dt className="[font-family:var(--font-mono)] text-[12px] text-[var(--text-tertiary)]">
              Daily limit
            </dt>
            <dd className="flex items-center gap-2 [font-family:var(--font-mono)] text-[12px]">
              <span className="text-[var(--text-tertiary)] line-through">5 SOL</span>
              <span className="text-[var(--text-tertiary)]">→</span>
              <span className="text-[var(--text-primary)]">2 SOL</span>
            </dd>
          </dl>
          <div className="mt-[18px] flex items-center justify-center gap-2 rounded-lg bg-[var(--text-primary)] px-3.5 py-[11px] text-[14px] font-medium text-[var(--bg)]">
            Apply &amp; sign
          </div>
        </div>
      </>
    ),
  },
  {
    id: "envelope",
    label: "The envelope",
    surface: "policy",
    thread: "Policy envelope",
    caption: (
      <>
        Every limit on this page is a field the program reads inside the
        instruction. Editing one is an owner-signed transaction, not a setting.
      </>
    ),
  },
  {
    id: "audit",
    label: "Audit trail",
    surface: "activity",
    thread: "Activity log",
    caption: (
      <>
        Allowed actions come from the on-chain ActionLog. Rejections are shown
        with the same weight — a refusal is the feature working.
      </>
    ),
  },
];

export function InsideTheApp() {
  // `index` and `phase` move together — entering a scene decides its opening
  // phase — while `typed` is deliberately separate: the typing interval writes
  // it on every keystroke, and folding it into the scheduler's state would
  // restart the scheduler forty times a command.
  const [{ index, phase }, setStep] = useState<{ index: number; phase: Phase }>(() => ({
    index: 0,
    phase: SCENES[0].command ? "typing" : "reveal",
  }));
  const [typed, setTyped] = useState(0);
  // On the server there is no IntersectionObserver, so start "visible" and let
  // the observer correct it on mount. Nothing about this is rendered, so there
  // is nothing to mismatch.
  const [visible, setVisible] = useState(() => typeof IntersectionObserver === "undefined");
  const reduced = usePrefersReducedMotion();
  const rootRef = useRef<HTMLDivElement>(null);

  const scene = SCENES[index];
  const running = visible && !reduced;

  const enter = useCallback((next: number) => {
    setTyped(0);
    setStep({ index: next, phase: SCENES[next].command ? "typing" : "reveal" });
  }, []);

  // Only animate what someone is actually looking at.
  useEffect(() => {
    const element = rootRef.current;
    if (!element || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      ([entry]) => setVisible(entry.isIntersecting),
      { threshold: 0 },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!running) return;
    const current = SCENES[index];

    if (phase === "typing" && current.command) {
      const command = current.command;
      let settle: ReturnType<typeof setTimeout> | undefined;
      let cursor = 0;
      const tick = setInterval(() => {
        cursor += 1;
        setTyped(cursor);
        if (cursor >= command.length) {
          clearInterval(tick);
          settle = setTimeout(
            () => setStep((step) => ({ ...step, phase: "thinking" })),
            AFTER_TYPE_MS,
          );
        }
      }, TYPE_MS);
      return () => {
        clearInterval(tick);
        if (settle) clearTimeout(settle);
      };
    }

    const delay =
      phase === "thinking"
        ? THINK_MS
        : phase === "settled"
          ? SETTLED_HOLD_MS
          : current.command
            ? REPLY_HOLD_MS
            : SURFACE_HOLD_MS;

    const timer = setTimeout(() => {
      if (phase === "thinking") setStep((step) => ({ ...step, phase: "reveal" }));
      else if (phase === "reveal" && current.twoBeats) {
        setStep((step) => ({ ...step, phase: "settled" }));
      } else enter((index + 1) % SCENES.length);
    }, delay);
    return () => clearTimeout(timer);
  }, [index, phase, running, enter]);

  // Reduced motion never runs the machine, so the scene is rendered at rest
  // rather than mid-type — derived, not stored, so no effect has to write it.
  const displayPhase: Phase = reduced ? (scene.twoBeats ? "settled" : "reveal") : phase;
  const displayTyped = reduced ? (scene.command?.length ?? 0) : typed;

  return (
    <section id="inside" className="pt-[100px] pb-[140px] max-[960px]:pb-[100px]">
      <Container>
        <div className="mb-14 max-w-[760px]">
          <Eyebrow accent className="mb-5 block">
            — Inside the app
          </Eyebrow>
          <h2 className="[font-family:var(--font-serif)] text-[clamp(40px,5.5vw,72px)] leading-[1.02] tracking-[-0.03em] [&_em]:text-[var(--accent)] [&_em]:italic">
            One input field.
            <br />
            The chain does the <em>saying no.</em>
          </h2>
          <p className="mt-7 max-w-[580px] text-[19px] leading-[1.55] text-[var(--text-secondary)]">
            Sends, pre-IPO stock buys, recurring orders, policy changes — all of
            it typed, all of it checked against an envelope the agent cannot
            cross. Here is the real thing, running.
          </p>
        </div>

        <div ref={rootRef}>
          <div className="overflow-hidden rounded-2xl bg-[var(--bg-card)] [border:0.5px_solid_var(--border-strong)] [box-shadow:0_60px_120px_-50px_rgba(0,0,0,0.7)]">
            <BrowserChrome surface={scene.surface} />

            {/* A fixed height, not a minimum: scenes differ in content by a
                couple of hundred pixels, and a window that grows and shrinks
                under the reader is the same jank in a nicer frame. */}
            <div className="grid h-[720px] grid-cols-[224px_1fr] grid-rows-[1fr] overflow-hidden max-[960px]:h-[640px] max-[960px]:grid-cols-1">
              <DemoSidebar surface={scene.surface} thread={scene.thread} />

              <main className="flex min-h-0 min-w-0 flex-col">
                <header className="flex h-[50px] shrink-0 items-center justify-between gap-3 px-6 [border-bottom:0.5px_solid_var(--border)]">
                  <div className="flex min-w-0 items-center gap-2 text-[13px]">
                    <span className="text-[var(--text-tertiary)] capitalize">
                      {SURFACE_LABEL[scene.surface]}
                    </span>
                    <span className="text-[var(--text-tertiary)]">›</span>
                    <span className="truncate font-medium">{scene.thread}</span>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <Chip>
                      <span
                        aria-hidden
                        className="h-1.5 w-1.5 rounded-full bg-[var(--success)]"
                      />
                      Agent live
                    </Chip>
                    <Chip className="max-[760px]:hidden">4.82 SOL</Chip>
                  </div>
                </header>

                {scene.surface === "chat" ? (
                  <ChatSurface scene={scene} phase={displayPhase} typed={displayTyped} />
                ) : scene.surface === "policy" ? (
                  <PolicySurface />
                ) : (
                  <ActivitySurface />
                )}
              </main>
            </div>
          </div>

          <SceneRail index={index} onSelect={enter} caption={scene.caption} />
        </div>
      </Container>
    </section>
  );
}

const SURFACE_LABEL: Record<Surface, string> = {
  chat: "Conversation",
  policy: "Policy",
  activity: "Activity",
};

// --- window chrome -------------------------------------------------------

function BrowserChrome({ surface }: { surface: Surface }) {
  const path = surface === "chat" ? "praxis.app / app" : `praxis.app / app / ${surface}`;
  return (
    <div className="flex items-center gap-4 bg-[var(--bg-elevated)] px-[18px] py-[14px] [border-bottom:0.5px_solid_var(--border)]">
      <div className="flex gap-[7px]">
        <span className="h-[11px] w-[11px] rounded-full bg-[#ED6A5E]" />
        <span className="h-[11px] w-[11px] rounded-full bg-[#F5BE4E]" />
        <span className="h-[11px] w-[11px] rounded-full bg-[#62C554]" />
      </div>
      <div className="flex flex-1 items-center gap-2 rounded-md bg-[var(--bg-card)] px-3.5 py-[5px] [font-family:var(--font-mono)] text-[12px] text-[var(--text-secondary)] [border:0.5px_solid_var(--border)]">
        <IconLock size={12} className="text-[var(--text-tertiary)]" />
        <span>{path}</span>
      </div>
      <span className="[font-family:var(--font-mono)] text-[11px] text-[var(--text-tertiary)] max-[760px]:hidden">
        7xK…Bgh2 · devnet
      </span>
    </div>
  );
}

const SIDEBAR_THREADS = [
  "Send to Maya",
  "Cold storage",
  "OPENAI buy",
  "SPACEX weekly",
  "Tighten the cap",
];

function DemoSidebar({ surface, thread }: { surface: Surface; thread: string }) {
  return (
    <aside className="flex min-h-0 flex-col overflow-hidden bg-[var(--bg-elevated)] px-3.5 py-[18px] [border-right:0.5px_solid_var(--border)] max-[960px]:hidden">
      <div className="mb-5 flex items-center gap-2 px-1.5 py-1">
        <PraxisLogoMark size={22} />
        <span className="[font-family:var(--font-serif)] text-[18px]">Praxis</span>
        <span className="ml-auto [font-family:var(--font-mono)] text-[10px] text-[var(--text-tertiary)]">
          v0.1
        </span>
      </div>

      <nav className="mb-6 flex flex-col gap-0.5">
        <NavRow icon={<IconMessages size={16} />} label="Conversation" active={surface === "chat"} />
        <NavRow icon={<IconShieldLock size={16} />} label="Policy" active={surface === "policy"} />
        <NavRow
          icon={<IconHistory size={16} />}
          label="Activity"
          active={surface === "activity"}
          badge="1"
        />
      </nav>

      <div className="px-1.5 pb-2 [font-family:var(--font-mono)] text-[10px] tracking-[0.1em] text-[var(--text-tertiary)] uppercase">
        Today
      </div>
      {SIDEBAR_THREADS.map((item) => (
        <span
          key={item}
          className={`mb-px w-full truncate rounded-md px-2.5 py-[7px] text-left text-[13px] [transition:background_0.3s,color_0.3s] ${
            item === thread
              ? "bg-[var(--bg-card)] text-[var(--text-primary)]"
              : "text-[var(--text-secondary)]"
          }`}
        >
          {item}
        </span>
      ))}

      <div className="mt-auto flex items-center gap-2.5 px-1.5 pt-4 [border-top:0.5px_solid_var(--border)]">
        <span
          aria-hidden
          className="h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--success)]"
        />
        <div className="min-w-0">
          <div className="[font-family:var(--font-mono)] text-[10px] text-[var(--text-tertiary)]">
            agent live
          </div>
          <div className="[font-family:var(--font-mono)] text-[12px] text-[var(--text-primary)]">
            4.82 SOL
          </div>
        </div>
      </div>
    </aside>
  );
}

function NavRow({
  icon,
  label,
  active,
  badge,
}: {
  icon: ReactNode;
  label: string;
  active: boolean;
  badge?: string;
}) {
  return (
    <span
      className={`flex items-center gap-2.5 rounded-md px-2.5 py-[7px] text-[13px] [transition:background_0.3s,color_0.3s] ${
        active
          ? "bg-[var(--bg-card)] text-[var(--text-primary)]"
          : "text-[var(--text-secondary)]"
      }`}
    >
      <span className={active ? "text-[var(--accent)]" : "text-[var(--text-tertiary)]"}>
        {icon}
      </span>
      {label}
      {badge && (
        <span className="ml-auto flex h-4 min-w-4 items-center justify-center rounded-full bg-[rgba(199,91,91,0.16)] px-1 [font-family:var(--font-mono)] text-[9px] text-[var(--danger)]">
          {badge}
        </span>
      )}
    </span>
  );
}

function Chip({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <span
      className={`inline-flex items-center gap-[7px] rounded-full bg-[var(--bg-elevated)] px-[11px] py-1 [font-family:var(--font-mono)] text-[12px] text-[var(--text-secondary)] [border:0.5px_solid_var(--border)] ${className}`}
    >
      {children}
    </span>
  );
}

// --- surfaces ------------------------------------------------------------

function ChatSurface({
  scene,
  phase,
  typed,
}: {
  scene: Scene;
  phase: Phase;
  typed: number;
}) {
  const command = scene.command ?? "";
  const sent = phase !== "typing";

  return (
    <>
      {/* Bottom-aligned, like a thread scrolled to its newest message: an
          empty scene sits against the composer instead of leaving a void
          above it, and an over-long one clips at the top the way a real
          scrollback does. */}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col justify-end overflow-hidden px-8 py-7 max-[760px]:px-5">
        {scene.history}

        {sent && (
          <div className="mb-6 [animation:sceneIn_0.3s_ease]">
            <div className="mb-1.5 [font-family:var(--font-mono)] text-[11px] text-[var(--text-tertiary)]">
              You · 2:14 PM
            </div>
            <div className="flex items-start gap-3 [font-family:var(--font-mono)] text-[14px]">
              <span className="text-[var(--accent)]">›</span>
              <span>{command}</span>
            </div>
          </div>
        )}

        {phase === "thinking" && <Thinking />}

        {(phase === "reveal" || phase === "settled") && (
          <div className="[animation:sceneIn_0.35s_ease]">
            <div className="mb-1.5 [font-family:var(--font-mono)] text-[11px] text-[var(--text-tertiary)]">
              Praxis · 2:14 PM
            </div>
            <div className="text-[14px] leading-[1.6] text-[var(--text-secondary)]">
              {scene.reply?.(phase === "settled")}
            </div>
          </div>
        )}
      </div>

      <div className="shrink-0 bg-[var(--bg-elevated)] px-8 pt-3.5 pb-4 [border-top:0.5px_solid_var(--border)] max-[760px]:px-5">
        <div className="flex items-center gap-2.5 rounded-lg bg-[var(--bg-card)] px-3.5 py-2.5 [border:0.5px_solid_var(--border-strong)]">
          <span aria-hidden className="[font-family:var(--font-mono)] text-[var(--accent)]">
            ›
          </span>
          <span className="min-w-0 flex-1 truncate [font-family:var(--font-mono)] text-[13px]">
            {phase === "typing" ? (
              <>
                <span className="text-[var(--text-primary)]">{command.slice(0, typed)}</span>
                <span className="border-r-[1.5px] border-r-[var(--text-primary)] [animation:caretBlink_1s_steps(2)_infinite]">
                  {" "}
                </span>
              </>
            ) : (
              <span className="text-[var(--text-tertiary)]">Tell Praxis what to do…</span>
            )}
          </span>
          <span className="shrink-0 [font-family:var(--font-mono)] text-[10px] text-[var(--text-tertiary)]">
            ↵ to send
          </span>
        </div>
        <div className="mt-2.5 [font-family:var(--font-mono)] text-[10px] text-[var(--text-tertiary)]">
          ↵ to send · every action is policy-checked before you sign
        </div>
      </div>
    </>
  );
}

function PolicySurface() {
  return (
    <div className="min-w-0 flex-1 overflow-hidden px-8 py-7 [animation:sceneIn_0.35s_ease] max-[760px]:px-5">
      <h3 className="[font-family:var(--font-serif)] text-[30px] leading-none tracking-[-0.02em]">
        Policy envelope
      </h3>
      <p className="mt-2.5 text-[13.5px] text-[var(--text-secondary)]">
        What the agent may do — enforced on-chain by Aegis, not by a
        backend&rsquo;s good behavior.
      </p>

      <div className="mt-5 rounded-xl bg-[var(--bg)] p-5 [border:0.5px_solid_var(--border)]">
        <PanelLabel>Spent today</PanelLabel>
        <div className="mt-2 flex items-end justify-between gap-4">
          <div className="[font-family:var(--font-serif)] text-[38px] leading-none tracking-[-0.02em]">
            0.18 <span className="text-[20px] text-[var(--text-tertiary)]">SOL</span>
          </div>
          <div className="text-right [font-family:var(--font-mono)] text-[11px] text-[var(--text-tertiary)]">
            <div>4.82 SOL left</div>
            <div>of 5 SOL daily cap</div>
          </div>
        </div>
        <div className="mt-4 h-2 overflow-hidden rounded-full bg-[var(--bg-elevated)]">
          <div className="h-full w-[4%] rounded-full bg-[var(--accent)]" />
        </div>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-4 max-[760px]:grid-cols-1">
        <div className="rounded-xl bg-[var(--bg)] p-5 [border:0.5px_solid_var(--border)]">
          <PanelLabel>Caps</PanelLabel>
          <Row label="Per transaction" value="2 SOL" />
          <div className="my-3 h-px bg-[var(--border)]" />
          <Row label="Daily limit" value="5 SOL" />
        </div>
        <div className="rounded-xl bg-[var(--bg)] p-5 [border:0.5px_solid_var(--border)]">
          <PanelLabel>Token envelope</PanelLabel>
          <Row label="OPENAI · Token-2022" value="500 / day" />
          <div className="my-3 h-px bg-[var(--border)]" />
          <Row label="Session key" value="expires in 6d" />
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2 rounded-xl bg-[var(--bg)] p-5 [border:0.5px_solid_var(--border)]">
        <PanelLabel className="mr-2 mb-0">Allow-lists</PanelLabel>
        {["System Program", "SPL Token", "Token-2022", "2 recipients"].map((item) => (
          <span
            key={item}
            className="rounded-full bg-[var(--bg-elevated)] px-3 py-1.5 [font-family:var(--font-mono)] text-[11px] text-[var(--text-secondary)] [border:0.5px_solid_var(--border)]"
          >
            {item}
          </span>
        ))}
      </div>
    </div>
  );
}

function ActivitySurface() {
  return (
    <div className="min-w-0 flex-1 overflow-hidden px-8 py-7 [animation:sceneIn_0.35s_ease] max-[760px]:px-5">
      <h3 className="[font-family:var(--font-serif)] text-[30px] leading-none tracking-[-0.02em]">
        Activity
      </h3>
      <p className="mt-2.5 text-[13.5px] text-[var(--text-secondary)]">
        Every agent action and its on-chain Aegis verdict. Allowed actions are
        recorded on-chain; rejections are shown for this session.
      </p>
      <div className="mt-2 [font-family:var(--font-mono)] text-[11px] text-[var(--text-tertiary)]">
        4 actions · 1 rejected
      </div>

      <div className="mt-6 flex flex-col gap-2.5">
        <ActivityRow
          rejected
          label="Cold storage"
          amount="50 SOL"
          detail="50 SOL exceeds the 4.32 SOL left on your rolling daily cap."
          meta="2m ago"
        />
        <ActivityRow label="Maya Chen" amount="40 OPENAI" meta="14m ago · 5JLj…H6gr" />
        <ActivityRow label="Maya Chen" amount="0.5 SOL" meta="1h ago · 3vK2…X9aF" />
      </div>
    </div>
  );
}

function ActivityRow({
  rejected = false,
  label,
  amount,
  detail,
  meta,
}: {
  rejected?: boolean;
  label: string;
  amount: string;
  detail?: string;
  meta: string;
}) {
  return (
    <div
      className="flex items-start gap-3.5 rounded-xl px-4 py-3.5"
      style={{
        background: rejected ? "rgba(199,91,91,0.08)" : "var(--bg)",
        border: `0.5px solid ${rejected ? "rgba(199,91,91,0.28)" : "var(--border)"}`,
      }}
    >
      <span
        className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full"
        style={{
          background: rejected ? "rgba(199,91,91,0.16)" : "rgba(127,176,105,0.14)",
          color: rejected ? "var(--danger)" : "var(--success)",
        }}
      >
        {rejected ? <IconShieldX size={16} /> : <IconCheck size={16} />}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[14px] font-medium text-[var(--text-primary)]">{label}</span>
          <span className="[font-family:var(--font-mono)] text-[12px] text-[var(--text-secondary)]">
            {amount}
          </span>
          <span
            className="rounded-full px-2 py-0.5 [font-family:var(--font-mono)] text-[9px] tracking-[0.1em] uppercase"
            style={{
              color: rejected ? "var(--danger)" : "var(--success)",
              background: rejected ? "rgba(199,91,91,0.14)" : "rgba(127,176,105,0.12)",
            }}
          >
            {rejected ? "Rejected" : "Allowed"}
          </span>
        </div>
        {detail && (
          <p className="mt-1.5 text-[12.5px] leading-[1.5] text-[var(--text-secondary)]">
            {detail}
          </p>
        )}
        <div className="mt-1.5 flex items-center gap-1.5 [font-family:var(--font-mono)] text-[10px] text-[var(--text-tertiary)]">
          {meta}
          {!rejected && <IconExternalLink size={11} />}
        </div>
      </div>
    </div>
  );
}

// --- rail ----------------------------------------------------------------

function SceneRail({
  index,
  onSelect,
  caption,
}: {
  index: number;
  onSelect: (next: number) => void;
  caption: ReactNode;
}) {
  return (
    <div className="mt-7 flex items-start justify-between gap-10 max-[960px]:flex-col max-[960px]:gap-5">
      <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Walkthrough scenes">
        {SCENES.map((scene, i) => (
          <button
            key={scene.id}
            type="button"
            role="tab"
            aria-selected={i === index}
            onClick={() => onSelect(i)}
            className={`rounded-full px-3 py-1.5 [font-family:var(--font-mono)] text-[11px] [border:0.5px_solid] [transition:background-color_0.2s,color_0.2s,border-color_0.2s] ${
              i === index
                ? "bg-[var(--text-primary)] text-[var(--bg)] [border-color:var(--text-primary)]"
                : "text-[var(--text-tertiary)] [border-color:var(--border-strong)] hover:text-[var(--text-primary)]"
            }`}
          >
            {scene.label}
          </button>
        ))}
      </div>
      <p className="max-w-[420px] text-[13.5px] leading-[1.6] text-[var(--text-tertiary)] max-[960px]:max-w-none">
        {caption}
      </p>
    </div>
  );
}

// --- bits ----------------------------------------------------------------

function History({
  command,
  at,
  children,
}: {
  command: string;
  at: string;
  children: ReactNode;
}) {
  return (
    <div className="shrink-0">
      <div className="opacity-55">
        <div className="mb-1.5 [font-family:var(--font-mono)] text-[11px] text-[var(--text-tertiary)]">
          You · {at}
        </div>
        <div className="mb-3 flex items-start gap-3 [font-family:var(--font-mono)] text-[14px]">
          <span className="text-[var(--accent)]">›</span>
          <span>{command}</span>
        </div>
        <div className="text-[14px] leading-[1.6] text-[var(--text-secondary)]">{children}</div>
      </div>
      <div className="my-7 flex items-center gap-3.5 [font-family:var(--font-mono)] text-[10px] tracking-[0.14em] text-[var(--text-tertiary)] uppercase before:h-px before:flex-1 before:bg-[var(--border)] before:content-[''] after:h-px after:flex-1 after:bg-[var(--border)] after:content-['']">
        New · 2:14 PM
      </div>
    </div>
  );
}

function Prose({ children }: { children: ReactNode }) {
  return (
    <p className="mb-1 [&_strong]:font-medium [&_strong]:text-[var(--text-primary)]">
      {children}
    </p>
  );
}

function Note({ children, tone }: { children: ReactNode; tone: "success" | "danger" }) {
  const success = tone === "success";
  return (
    <div
      className="mt-2 flex items-start gap-2.5 rounded-lg px-3.5 py-3 text-[13px] leading-[1.5]"
      style={{
        background: success ? "rgba(127,176,105,0.10)" : "rgba(199,91,91,0.10)",
        border: `0.5px solid ${success ? "rgba(127,176,105,0.28)" : "rgba(199,91,91,0.28)"}`,
        color: success ? "var(--success)" : "var(--text-secondary)",
      }}
    >
      {success ? (
        <IconShieldCheck size={15} className="mt-[2px] shrink-0" />
      ) : (
        <IconShieldX size={15} className="mt-[2px] shrink-0 text-[var(--danger)]" />
      )}
      <span>{children}</span>
    </div>
  );
}

function PanelLabel({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={`[font-family:var(--font-mono)] text-[10px] tracking-[0.14em] text-[var(--text-tertiary)] uppercase ${className}`}
    >
      {children}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="mt-3 flex items-center justify-between">
      <span className="text-[13px] text-[var(--text-secondary)]">{label}</span>
      <span className="[font-family:var(--font-mono)] text-[13px] text-[var(--text-primary)]">
        {value}
      </span>
    </div>
  );
}

/** Honour the OS setting: no auto-advance, no typing, nothing moving. */
const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

function subscribeReducedMotion(onChange: () => void): () => void {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return () => undefined;
  }
  const query = window.matchMedia(REDUCED_MOTION_QUERY);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

function readReducedMotion(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  return window.matchMedia(REDUCED_MOTION_QUERY).matches;
}

function usePrefersReducedMotion(): boolean {
  return useSyncExternalStore(subscribeReducedMotion, readReducedMotion, () => false);
}
