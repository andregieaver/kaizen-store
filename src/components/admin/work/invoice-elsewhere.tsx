"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { recordElsewhereAction } from "@/app/admin/(gated)/(owner)/account/work/s/[store]/invoice-actions";
import { useAdminText } from "@/components/admin/admin-text";

import { card, control, Field, hintText, Problems, secondaryButton } from "./work-parts";

/**
 * *Issued elsewhere already?* under a draft (D499): the draft's client and lines recorded as an invoice sent before from another system
 * or by hand, with the number and days it had, so the books hold the year's sales. Lisa's: folded away; Homer issues the draft.
 */
export function InvoiceElsewhere({ storeSlug, invoiceId, list, today, blocked }: { storeSlug: string; invoiceId: string; list: string; today: string; blocked: string | null }) {
  const tw = useAdminText("work").invoiceDraftEditor;
  const router = useRouter();
  const [number, setNumber] = useState("");
  const [issuedOn, setIssuedOn] = useState("");
  const [dueOn, setDueOn] = useState("");
  const [problems, setProblems] = useState<string[]>([]);
  const [busy, start] = useTransition();

  const record = () => {
    setProblems([]);
    start(async () => {
      try {
        const result = await recordElsewhereAction(storeSlug, { invoiceId, number, issuedOn, ...(dueOn ? { dueOn } : {}) });
        if (result.ok) router.push(`${list}/${result.invoiceId}`);
        else setProblems(result.problems);
      } catch {
        setProblems([tw.elsewhereFailed]);
      }
    });
  };

  return (
    <details className={card}>
      <summary className="cursor-pointer text-title text-ink">{tw.elsewhereTitle}</summary>
      <p className={`mt-2 ${hintText}`}>{tw.elsewhereText}</p>
      <div className="mt-4 flex flex-wrap items-end gap-3">
        <Field label={tw.elsewhereNumber} className="w-40">
          {(p) => <input {...p} value={number} onChange={(e) => setNumber(e.target.value)} maxLength={50} className={control} />}
        </Field>
        <Field label={tw.elsewhereIssuedOn} className="w-44">
          {(p) => <input {...p} type="date" value={issuedOn} max={today} onChange={(e) => setIssuedOn(e.target.value)} className={control} />}
        </Field>
        <Field label={tw.elsewhereDueOn} className="w-48">
          {(p) => <input {...p} type="date" value={dueOn} min={issuedOn || undefined} onChange={(e) => setDueOn(e.target.value)} className={control} />}
        </Field>
        <button type="button" onClick={record} disabled={busy || blocked !== null || !number.trim() || !issuedOn} className={secondaryButton}>
          {busy ? tw.elsewhereRecording : tw.elsewhereButton}
        </button>
      </div>
      {blocked && <p className={`mt-2 ${hintText}`}>{blocked}</p>}
      <div className="mt-2">
        <Problems messages={problems} />
      </div>
    </details>
  );
}
