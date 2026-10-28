"use client";

import { useState, useTransition } from "react";

import { useAdminText } from "@/components/admin/admin-text";
import { countWords, fillWords } from "@/lib/admin-fill";
import type { MergeCounts } from "@/lib/customer-staff";

type Ask = { ok: true; other: string; email: string; counts: MergeCounts; bonus: string | null } | { ok: false; problem: string };

const COUNTED = ["orders", "subscriptions", "wishlists", "addresses", "tags", "notes", "fields"] as const;

/**
 * Merging another customer into this one (wave 10 unit C, D366): staff type the other customer's email, read what would move (or why it
 * cannot), and confirm. The server reads the plan again under both accounts' locks when they confirm; nothing changes before.
 */
export function CustomerMerge({ name, preview, merge }: { name: string; preview: (email: string) => Promise<Ask>; merge: (other: string) => Promise<{ ok: false; problem: string }> }) {
  const w = useAdminText("customers").staff.merge;
  const [email, setEmail] = useState("");
  const [ask, setAsk] = useState<Ask | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const shown = ask?.ok ? ask : null;
  const moves = shown ? COUNTED.filter((k) => shown.counts[k] > 0) : [];
  return (
    <div className="flex flex-col gap-4" aria-busy={pending}>
      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          start(async () => {
            setProblem(null);
            const answer = await preview(email);
            setAsk(answer);
            if (!answer.ok) setProblem(answer.problem);
          });
        }}
      >
        <label className="flex min-w-0 flex-1 flex-col gap-1 text-sm font-medium">
          {w.findLabel}
          <input type="email" required value={email} onChange={(e) => { setEmail(e.target.value); setAsk(null); }} autoComplete="off" className="min-h-10 rounded-md border border-line bg-card px-3 font-normal" />
        </label>
        <button type="submit" disabled={pending} className="min-h-10 rounded-pill border border-edge bg-card px-4 text-sm disabled:opacity-40">
          {w.find}
        </button>
      </form>
      {shown && (
        <section aria-label={fillWords(w.moves, { name })} className="flex flex-col gap-3 rounded-panel border border-line bg-sunken p-4 text-sm">
          <h2 className="text-title text-ink">{fillWords(w.moves, { name })}</h2>
          {moves.length === 0 && !shown.bonus ? (
            <p>{w.nothing}</p>
          ) : (
            <ul className="list-disc pl-5">
              {moves.map((k) => (
                <li key={k}>{countWords(shown.counts[k], w.counts[k])}</li>
              ))}
              {shown.bonus && <li>{fillWords(w.counts.bonus, { amount: shown.bonus })}</li>}
            </ul>
          )}
          <p>{fillWords(w.after, { email: shown.email })}</p>
          <div>
            <button
              type="button"
              disabled={pending}
              className="min-h-10 rounded-pill bg-danger-soft px-4 text-sm font-medium text-danger-text hover:bg-danger-line disabled:opacity-40"
              onClick={() =>
                start(async () => {
                  setProblem(null);
                  const failed = await merge(shown.other);
                  if (failed && !failed.ok) setProblem(failed.problem);
                })
              }
            >
              {w.confirm}
            </button>
          </div>
        </section>
      )}
      <div role="status" aria-live="polite">
        {problem && <p className="text-sm text-danger-text">{problem}</p>}
      </div>
    </div>
  );
}
