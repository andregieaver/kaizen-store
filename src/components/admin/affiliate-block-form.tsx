"use client";

import { useState, useTransition } from "react";

import { useAdminText } from "@/components/admin/admin-text";
import { fillWords } from "@/lib/admin-fill";
import { BLOCK_NOTE_MAX, BLOCK_NOTE_MIN } from "@/lib/affiliate-admin";
import type { AffiliateResult } from "@/lib/affiliates";

const control = "min-h-9 w-full rounded-md border border-line bg-card px-3 text-sm";

/**
 * Blocks a referrer, with a reason the audit log keeps, or lets them earn again (D131). A block stops new rewards and
 * the count of their link's visits; what they have earned stays. The answer is shown in place.
 */
export function AffiliateBlockForm({
  blocked,
  who,
  act,
}: {
  blocked: boolean;
  /** Who it is for, as the buttons name them. */
  who: string;
  act: (blocked: boolean, note: string) => Promise<AffiliateResult>;
}) {
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const w = useAdminText("loyalty").block;

  function run(nextBlocked: boolean) {
    const reason = note.trim();
    if (nextBlocked && (reason.length < BLOCK_NOTE_MIN || reason.length > BLOCK_NOTE_MAX)) {
      setProblem(fillWords(w.reasonProblem, { min: BLOCK_NOTE_MIN, max: BLOCK_NOTE_MAX }));
      return;
    }
    setProblem(null);
    startTransition(async () => {
      const result = await act(nextBlocked, reason);
      if (!result.ok) {
        setProblem(result.problems.join(" "));
        return;
      }
      setDone(nextBlocked ? w.blocked : w.unblocked);
      setOpen(false);
      setNote("");
    });
  }

  if (blocked) {
    return (
      <div className="flex flex-col items-start gap-1">
        <button
          type="button"
          disabled={pending}
          onClick={() => run(false)}
          className="min-h-9 rounded-pill border border-edge px-3 text-sm disabled:opacity-40"
        >
          {pending ? w.saving : fillWords(w.unblock, { who })}
        </button>
        {problem && <p className="text-sm text-danger-text">{problem}</p>}
        <span role="status" aria-live="polite" className="text-sm text-muted">
          {done}
        </span>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-start gap-2">
      {!open ? (
        <button type="button" onClick={() => setOpen(true)} className="min-h-9 rounded-pill border border-edge px-3 text-sm">
          {fillWords(w.block, { who })}
        </button>
      ) : (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            run(true);
          }}
          className="flex w-full max-w-sm flex-col gap-2"
        >
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium">{w.reason}</span>
            <input
              value={note}
              onChange={(event) => setNote(event.target.value)}
              maxLength={BLOCK_NOTE_MAX}
              aria-invalid={problem ? true : undefined}
              className={control}
            />
          </label>
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={pending}
              className="min-h-9 rounded-pill bg-brand px-3 text-sm font-medium text-brand-ink disabled:opacity-40"
            >
              {pending ? w.saving : w.submit}
            </button>
            <button type="button" onClick={() => setOpen(false)} className="min-h-9 rounded-pill border border-edge px-3 text-sm">
              {w.cancel}
            </button>
          </div>
          {problem && <p className="text-sm text-danger-text">{problem}</p>}
        </form>
      )}
      <span role="status" aria-live="polite" className="text-sm text-muted">
        {done}
      </span>
    </div>
  );
}
