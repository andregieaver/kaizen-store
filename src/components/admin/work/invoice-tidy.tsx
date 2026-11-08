"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { deleteImportedAction, mergeImportedAction } from "@/app/admin/(gated)/(owner)/account/work/s/[store]/invoice-actions";
import { useAdminText } from "@/components/admin/admin-text";
import { fillWords } from "@/lib/admin-fill";

import { card, control, hintText, Problems, secondaryButton } from "./work-parts";

type Candidate = { id: string; number: string; issuedOn: string | null };

/**
 * Tidying an invoice brought in from elsewhere (D501), owners only and folded away: delete it, or merge it into the invoice it is the same
 * as (the same client, currency and total). Only while nothing hangs on it; one in the books has its entry reversed first.
 */
export function InvoiceTidy({ storeSlug, invoiceId, list, number, candidates }: { storeSlug: string; invoiceId: string; list: string; number: string; candidates: Candidate[] }) {
  const tw = useAdminText("work").invoiceTidy;
  const router = useRouter();
  const [into, setInto] = useState(candidates[0]?.id ?? "");
  const [problems, setProblems] = useState<string[]>([]);
  const [busy, start] = useTransition();

  const run = (act: () => Promise<{ ok: true } | { ok: false; problem: keyof typeof tw.problems }>, then: string) => {
    setProblems([]);
    start(async () => {
      try {
        const result = await act();
        if (result.ok) router.push(then);
        else setProblems([tw.problems[result.problem] ?? tw.failed]);
      } catch {
        setProblems([tw.failed]);
      }
    });
  };

  const remove = () => {
    if (!window.confirm(fillWords(tw.deleteConfirm, { number }))) return;
    run(() => deleteImportedAction(storeSlug, invoiceId), list);
  };
  const merge = () => {
    if (!into) return;
    run(() => mergeImportedAction(storeSlug, invoiceId, into), `${list}/${into}`);
  };

  return (
    <details className={card}>
      <summary className="cursor-pointer text-title text-ink">{tw.title}</summary>
      <p className={`mt-2 ${hintText}`}>{tw.text}</p>
      {candidates.length > 0 && (
        <div className="mt-4 flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1 text-sm font-medium">
            {tw.mergeInto}
            <select value={into} onChange={(e) => setInto(e.target.value)} className={`${control} min-w-56`}>
              {candidates.map((c) => (
                <option key={c.id} value={c.id}>
                  {fillWords(tw.candidate, { number: c.number || "–", day: c.issuedOn ?? "" })}
                </option>
              ))}
            </select>
          </label>
          <button type="button" onClick={merge} disabled={busy || !into} className={secondaryButton}>
            {tw.merge}
          </button>
        </div>
      )}
      {candidates.length === 0 && <p className={`mt-3 ${hintText}`}>{tw.noCandidates}</p>}
      <div className="mt-4">
        <button type="button" onClick={remove} disabled={busy} className={secondaryButton}>
          {busy ? tw.working : tw.delete}
        </button>
      </div>
      <div className="mt-2">
        <Problems messages={problems} />
      </div>
    </details>
  );
}
