"use client";

import { useEffect, useRef, useState } from "react";

import type { MotionPlan, MotionPlanResult } from "@/lib/motion-plan";

import { useAdminText } from "./admin-text";
import { Modal } from "./modal";

/** The button's words and the dialog's title. The wand button itself belongs to the page builder's toolbar. */
export const MAKE_COOL_LABEL = "Make my page cool";

export const MAKE_COOL_TEXT =
  "Your AI manager looks at your page and adds tasteful motion: entrances, hover effects and moving backgrounds. Nothing you already animated is changed.";

export type MakeCoolPhase = { name: "idle" } | { name: "running" } | { name: "error"; problem: string };

const IDLE: MakeCoolPhase = { name: "idle" };

const secondary = "min-h-10 rounded-pill border border-edge px-4 text-sm hover:bg-sunken disabled:opacity-50";
const primary = "min-h-10 rounded-pill bg-brand px-4 text-sm font-medium text-brand-ink disabled:opacity-50";

/** What the dialog says in each phase. While it works it says so in words, with a bar that only pulses where motion is welcome. */
export function MakeCoolBody({ phase }: { phase: MakeCoolPhase }) {
  const panel = useRef<HTMLDivElement>(null);
  const name = phase.name;
  const w = useAdminText("builder").cool;
  useEffect(() => {
    // Keeps a keyboard or screen reader user where the news is when the buttons go away or the answer comes.
    if (name !== "idle") panel.current?.focus();
  }, [name]);

  if (phase.name === "running") {
    return (
      <div ref={panel} tabIndex={-1} aria-busy="true" role="status" className="flex flex-col gap-3 outline-none">
        <p className="text-sm">{w.looking}</p>
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-sunken" aria-hidden>
          <div className="h-full w-1/3 rounded-full bg-inverse/60 motion-safe:animate-pulse" />
        </div>
      </div>
    );
  }
  if (phase.name === "error") {
    return (
      <div ref={panel} tabIndex={-1} role="alert" className="rounded-md border border-danger-text p-3 text-sm outline-none">
        {phase.problem}
      </div>
    );
  }
  return <p className="text-sm">{w.text}</p>;
}

/** Cancel and Go (Try again after a problem); both are off while the page is being looked at. */
export function MakeCoolButtons({
  phase,
  onCancel,
  onGo,
}: {
  phase: MakeCoolPhase;
  onCancel: () => void;
  onGo: () => void;
}) {
  const busy = phase.name === "running";
  const w = useAdminText("builder").cool;
  return (
    <>
      <button type="button" onClick={onCancel} disabled={busy} className={secondary}>
        {w.cancel}
      </button>
      <button type="button" onClick={onGo} disabled={busy} className={primary}>
        {phase.name === "error" ? w.tryAgain : w.go}
      </button>
    </>
  );
}

/**
 * "Make my page cool" (D128): a small dialog on the browser's own `<dialog>` (focus stays inside, Escape closes, focus
 * returns to the button that opened it). Go runs `run()`, which asks the server for a plan; on a plan it hands it to
 * `onApply` and closes, and the caller shows the summary. Closing while it works (Escape, the close button) drops the
 * answer: nothing is applied.
 */
export function MakeCoolDialog({
  open,
  onClose,
  run,
  onApply,
}: {
  open: boolean;
  onClose: () => void;
  run: () => Promise<MotionPlanResult>;
  onApply: (plan: MotionPlan) => void;
}) {
  const [phase, setPhase] = useState<MakeCoolPhase>(IDLE);
  const w = useAdminText("builder").cool;
  // Each run has a ticket; closing takes it away, so a late answer to a closed dialog is thrown away.
  const ticket = useRef(0);
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) setPhase(IDLE);
  }
  useEffect(() => {
    if (!open) ticket.current += 1;
  }, [open]);

  const close = () => {
    ticket.current += 1;
    onClose();
  };

  const go = async () => {
    const mine = ++ticket.current;
    setPhase({ name: "running" });
    let result: MotionPlanResult;
    try {
      result = await run();
    } catch {
      result = { ok: false, problem: w.failed };
    }
    if (mine !== ticket.current) return;
    if (!result.ok) {
      setPhase({ name: "error", problem: result.problem });
      return;
    }
    try {
      onApply(result.plan);
    } catch {
      setPhase({ name: "error", problem: w.failed });
      return;
    }
    onClose();
  };

  return (
    <Modal
      open={open}
      onClose={close}
      title={w.label}
      footer={<MakeCoolButtons phase={phase} onCancel={close} onGo={go} />}
    >
      <MakeCoolBody phase={phase} />
    </Modal>
  );
}
