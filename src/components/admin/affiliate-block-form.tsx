"use client";

import { useState, useTransition } from "react";

import { BLOCK_NOTE_MAX, BLOCK_NOTE_MIN } from "@/lib/affiliate-admin";
import type { AffiliateResult } from "@/lib/affiliates";

const control = "min-h-9 w-full rounded-md border border-border bg-background px-3 text-sm";

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

  function run(nextBlocked: boolean) {
    const reason = note.trim();
    if (nextBlocked && (reason.length < BLOCK_NOTE_MIN || reason.length > BLOCK_NOTE_MAX)) {
      setProblem(`Write a reason of ${BLOCK_NOTE_MIN} to ${BLOCK_NOTE_MAX} characters.`);
      return;
    }
    setProblem(null);
    startTransition(async () => {
      const result = await act(nextBlocked, reason);
      if (!result.ok) {
        setProblem(result.problems.join(" "));
        return;
      }
      setDone(nextBlocked ? "Blocked." : "Unblocked.");
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
          className="min-h-9 rounded-md border border-border px-3 text-sm disabled:opacity-40"
        >
          {pending ? "Saving …" : `Unblock ${who}`}
        </button>
        {problem && <p className="text-sm text-red-700 dark:text-red-400">{problem}</p>}
        <span role="status" aria-live="polite" className="text-sm text-muted">
          {done}
        </span>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-start gap-2">
      {!open ? (
        <button type="button" onClick={() => setOpen(true)} className="min-h-9 rounded-md border border-border px-3 text-sm">
          Block {who}
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
            <span className="font-medium">Reason (kept in the audit log)</span>
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
              className="min-h-9 rounded-md bg-foreground px-3 text-sm font-medium text-background disabled:opacity-40"
            >
              {pending ? "Saving …" : "Block"}
            </button>
            <button type="button" onClick={() => setOpen(false)} className="min-h-9 rounded-md border border-border px-3 text-sm">
              Cancel
            </button>
          </div>
          {problem && <p className="text-sm text-red-700 dark:text-red-400">{problem}</p>}
        </form>
      )}
      <span role="status" aria-live="polite" className="text-sm text-muted">
        {done}
      </span>
    </div>
  );
}
