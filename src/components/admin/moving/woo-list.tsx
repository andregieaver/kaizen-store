"use client";

import { useActionState, useId } from "react";

import { hint, secondary } from "@/components/admin/data/ui";
import { fillWords } from "@/lib/admin-fill";
import type { ListImport } from "@/server/woocommerce-list";

import { useAdminText } from "../admin-text";

/**
 * *Your email list in Mailchimp or Klaviyo?* (D446 step 2b): Lisa's, folded away; the export file and one button. Only the export's subscribed
 * rows with their date come over, through the email list's own writer.
 */
export function WooList({ action }: { action: (state: ListImport | null, form: FormData) => Promise<ListImport | null> }) {
  const w = useAdminText("moving").woo.list;
  const id = useId();
  const [state, submit, pending] = useActionState(action, null);
  return (
    <details className="text-sm">
      <summary className="w-fit cursor-pointer underline underline-offset-2">{w.title}</summary>
      <form action={submit} className="mt-2 flex flex-col gap-2">
        <p>{w.text}</p>
        <p className={hint}>{w.how}</p>
        <label htmlFor={`${id}-file`} className="font-medium">
          {w.file}
        </label>
        <input id={`${id}-file`} name="file" type="file" accept=".csv,text/csv" className="text-sm" />
        <div>
          <button type="submit" disabled={pending} className={secondary}>
            {pending ? w.working : w.button}
          </button>
        </div>
        {state && (
          <p role={state.ok ? "status" : "alert"} className={state.ok ? "text-sm" : "text-sm text-danger-text"}>
            {state.ok
              ? fillWords(w.done, { added: String(state.added), already: String(state.already), skipped: String(state.skipped), source: state.source === "mailchimp" ? "Mailchimp" : "Klaviyo" })
              : w.problems[state.problem]}
          </p>
        )}
      </form>
    </details>
  );
}
