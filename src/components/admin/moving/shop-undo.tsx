"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { hint, primary, secondary } from "@/components/admin/data/ui";
import { countWords } from "@/lib/admin-fill";

import { useAdminText } from "../admin-text";

export type UndoOutcome = { ok: true; removed: number; kept: number } | { ok: false; problem: "real_orders" | "nothing" | "forbidden" };

/**
 * *Undo this copy* (D445 step 9, `docs/moving-from-shopify.md` 8.4): Lisa's, one step away and behind a confirmation that says what goes.
 * Gone, with the reason, once the store has had its first real order.
 */
export function ShopUndo({ total, allowed, undo }: { total: number; allowed: boolean; undo: () => Promise<UndoOutcome> }) {
  const w = useAdminText("moving").undo;
  const router = useRouter();
  const [pending, start] = useTransition();
  const [asking, setAsking] = useState(false);
  const [said, setSaid] = useState<string | null>(null);
  if (!allowed) return said ? <p role="status" className="text-sm">{said}</p> : total > 0 ? <p className={hint}>{w.gone}</p> : null;
  return (
    <div className="flex flex-col gap-2">
      {!asking ? (
        <div>
          <button type="button" className={secondary} onClick={() => setAsking(true)}>
            {w.button}
          </button>
        </div>
      ) : (
        <div className="flex flex-col gap-2" role="alertdialog" aria-label={w.button}>
          <p className="text-sm">{countWords(total, w.ask)}</p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={pending}
              className={primary}
              onClick={() =>
                start(async () => {
                  const result = await undo();
                  setAsking(false);
                  setSaid(result.ok ? [countWords(result.removed, w.done), result.kept > 0 ? countWords(result.kept, w.kept) : ""].filter(Boolean).join(" ") : result.problem === "real_orders" ? w.gone : w.failed);
                  router.refresh();
                })
              }
            >
              {pending ? w.undoing : w.confirm}
            </button>
            <button type="button" disabled={pending} className={secondary} onClick={() => setAsking(false)}>
              {w.cancel}
            </button>
          </div>
        </div>
      )}
      {said && (
        <p role="status" className="text-sm">
          {said}
        </p>
      )}
    </div>
  );
}
