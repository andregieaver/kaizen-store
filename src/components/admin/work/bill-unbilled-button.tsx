"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { billUnbilledAction } from "@/app/admin/(gated)/(owner)/account/work/s/[store]/invoice-view-actions";

import { Problems, secondaryButton } from "./work-parts";
import { workBase } from "@/lib/work-paths";

/**
 * "Bill unbilled time" (docs/work.md 6.4): opens the assignment's draft invoice (or starts one; a client without an
 * assignment gets one of its own) and makes its lines from the time nothing has invoiced yet, in one step, then
 * goes to the invoice to be looked over. An assignment already has at most one draft, so that one is used and never a
 * second made. Nothing is left behind when there was nothing to bill: it says so.
 */
export function BillUnbilledButton({
  storeSlug,
  clientId,
  assignmentId,
  label = "Bill unbilled time",
  className,
}: {
  storeSlug: string;
  clientId?: string;
  assignmentId?: string;
  label?: string;
  className?: string;
}) {
  const router = useRouter();
  const [problems, setProblems] = useState<string[]>([]);
  const [pending, start] = useTransition();

  const bill = () => {
    setProblems([]);
    start(async () => {
      try {
        const result = await billUnbilledAction(storeSlug, {
          clientId: clientId ?? null,
          assignmentId: assignmentId ?? null,
        });
        if (result.ok) router.push(`${workBase(storeSlug)}/invoices/${result.invoiceId}`);
        else setProblems(result.problems);
      } catch {
        setProblems(["The invoice could not be made. Check your connection and try again."]);
      }
    });
  };

  return (
    <span className="inline-flex flex-col gap-1">
      <button
        type="button"
        onClick={bill}
        disabled={pending}
        aria-busy={pending}
        className={className ?? secondaryButton}
      >
        {pending ? "Making the invoice …" : label}
      </button>
      <Problems messages={problems} />
    </span>
  );
}
