import Link from "next/link";

import { ActionForm, SubmitButton, type FormState } from "@/components/admin/action-form";
import type { RequestRow } from "@/server/support-actions";

/** A staff request's kind, as staff read it. */
export const REQUEST_KIND_WORDS: Record<RequestRow["kind"], string> = {
  refund: "Refund",
  cancel_order: "Cancel order",
  change_address: "Change address",
  exception: "Exception",
  other: "Other",
};

/**
 * The desk's staff requests (D216, `docs/support.md` 2.4, step 10): what the AI passed to a person, with the conversation, the order and
 * the customer. A person does the work in the store's own screens (the order page), then marks it **Done** or **Declines** it, with an
 * optional note that reaches the customer. The decided ones are listed too, newest first.
 */
export function RequestsView({
  rows,
  which,
  base,
  decide,
  now,
}: {
  rows: RequestRow[];
  which: "open" | "decided";
  /** The store's admin address, `/admin/{store}`. */
  base: string;
  /** The bound action per request, or null for someone who may only read. */
  decide: ((id: string) => (state: FormState, form: FormData) => Promise<FormState>) | null;
  now: Date;
}) {
  return (
    <div className="flex flex-col gap-4">
      <nav aria-label="Requests" className="flex gap-2 text-sm">
        <Link href={`${base}/support/requests`} aria-current={which === "open" ? "page" : undefined} className={`rounded-lg border border-line px-3 py-1.5 ${which === "open" ? "bg-sunken font-medium" : ""}`}>
          To decide
        </Link>
        <Link href={`${base}/support/requests?show=decided`} aria-current={which === "decided" ? "page" : undefined} className={`rounded-lg border border-line px-3 py-1.5 ${which === "decided" ? "bg-sunken font-medium" : ""}`}>
          Decided
        </Link>
      </nav>
      {rows.length === 0 ? (
        <p className="text-muted">{which === "open" ? "No requests wait for a decision." : "No requests have been decided yet."}</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {rows.map((row) => (
            <li key={row.id} className="flex flex-col gap-2 rounded-lg border border-line bg-sunken p-4">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p className="font-medium">
                  {REQUEST_KIND_WORDS[row.kind]}
                  {row.orderNumber && (
                    <>
                      {" · "}
                      {row.orderId ? (
                        <Link href={`${base}/orders/${row.orderId}`} className="underline">
                          Order {row.orderNumber}
                        </Link>
                      ) : (
                        <span>Order {row.orderNumber} (not found)</span>
                      )}
                    </>
                  )}
                </p>
                <p className="text-sm text-muted">
                  <time dateTime={row.createdAt}>{ago(row.createdAt, now)}</time>
                </p>
              </div>
              {row.details && (
                <p className="text-sm">
                  <span className="text-muted">The AI assistant wrote: </span>
                  {row.details}
                </p>
              )}
              <p className="text-sm text-muted">
                The customer sees: {row.summary} · {row.customer ? `${row.customer.name || row.customer.email} (signed in)` : "Not signed in"} ·{" "}
                <Link href={`${base}/support?c=${row.conversationId}`} className="underline">
                  Open the conversation
                </Link>
              </p>
              {which === "decided" ? (
                <p className="text-sm">
                  {row.status === "done" ? "Done" : "Declined"}
                  {row.decidedBy ? ` by ${row.decidedBy}` : ""}
                  {row.note ? ` · Note to the customer: ${row.note}` : ""}
                </p>
              ) : (
                decide && (
                  <ActionForm action={decide(row.id)} className="flex flex-col gap-2">
                    <label className="flex flex-col gap-1 text-sm">
                      Note to the customer (optional)
                      <textarea name="note" maxLength={500} rows={2} className="rounded-lg border border-line bg-card px-3 py-2" />
                    </label>
                    <div className="flex flex-wrap gap-2">
                      <SubmitButton name="decision" value="done">
                        Done
                      </SubmitButton>
                      <SubmitButton name="decision" value="declined" variant="secondary">
                        Decline
                      </SubmitButton>
                    </div>
                    <p className="text-xs text-muted">Do the work in the store&apos;s own screens first (the order page), then mark it done. The customer is told in the chat, and by email when away.</p>
                  </ActionForm>
                )
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ago(iso: string, now: Date): string {
  const minutes = Math.max(0, Math.round((now.getTime() - Date.parse(iso)) / 60_000));
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours} h ago`;
  return `${Math.round(hours / 24)} days ago`;
}
