import Link from "next/link";

import type { FormState } from "@/components/admin/action-form";
import { fillWords } from "@/lib/admin-fill";
import {
  supportEn,
  type SupportMessages,
} from "@/lib/admin-messages/support.en";
import type { RequestRow } from "@/server/support-actions";
import type { RequestChoice } from "@/server/support-carry-out";

import { RequestActions } from "./request-actions";

/**
 * The desk's staff requests (D216, `docs/support.md` 2.4, step 10): what the AI passed to a person, with the conversation, the order and
 * the customer. A request the order page's own function can do is carried out here (ecosystem plan E2.7, D713: a cancellation, an address
 * change, a refund) for a person who may change orders; anything else is done in the store's own screens, then marked **Done**, or it is
 * **Declined**, with an optional note that reaches the customer. The decided ones are listed too, newest first.
 */
export function RequestsView({
  rows,
  which,
  base,
  decide,
  carryOut = null,
  choices = {},
  now,
  words = supportEn,
}: {
  rows: RequestRow[];
  which: "open" | "decided";
  /** The store's admin address, `/admin/{store}`. */
  base: string;
  /** The bound action per request, or null for someone who may only read. */
  decide:
    | ((id: string) => (state: FormState, form: FormData) => Promise<FormState>)
    | null;
  /** The bound carry-out per request, for someone who may decide requests and change orders. */
  carryOut?: ((id: string) => (state: FormState, form: FormData) => Promise<FormState>) | null;
  /** What each open request offers (`requestChoices()`). */
  choices?: Record<string, RequestChoice>;
  now: Date;
  words?: SupportMessages;
}) {
  const w = words.requests;
  return (
    <div className="flex flex-col gap-4">
      <nav aria-label={w.nav} className="flex gap-2 text-sm">
        <Link
          href={`${base}/support/requests`}
          aria-current={which === "open" ? "page" : undefined}
          className={`rounded-panel px-3 py-1.5 ${which === "open" ? "bg-sunken font-medium" : ""}`}
        >
          {w.toDecide}
        </Link>
        <Link
          href={`${base}/support/requests?show=decided`}
          aria-current={which === "decided" ? "page" : undefined}
          className={`rounded-panel px-3 py-1.5 ${which === "decided" ? "bg-sunken font-medium" : ""}`}
        >
          {w.decided}
        </Link>
      </nav>
      {rows.length === 0 ? (
        <p className="text-muted">
          {which === "open" ? w.noneOpen : w.noneDecided}
        </p>
      ) : (
        <ul className="flex flex-col gap-3">
          {rows.map((row) => (
            <li
              key={row.id}
              className="flex flex-col gap-2 rounded-panel bg-sunken p-4"
            >
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p className="font-medium">
                  {w.kinds[row.kind]}
                  {row.orderNumber && (
                    <>
                      {" · "}
                      {row.orderId ? (
                        <Link
                          href={`${base}/orders/${row.orderId}`}
                          className="underline"
                        >
                          {fillWords(w.order, { number: row.orderNumber })}
                        </Link>
                      ) : (
                        <span>
                          {fillWords(w.orderNotFound, {
                            number: row.orderNumber,
                          })}
                        </span>
                      )}
                    </>
                  )}
                </p>
                <p className="text-sm text-muted">
                  <time dateTime={row.createdAt}>
                    {ago(row.createdAt, now, w)}
                  </time>
                </p>
              </div>
              {row.details && (
                <p className="text-sm">
                  <span className="text-muted">{w.aiWrote} </span>
                  {row.details}
                </p>
              )}
              <p className="text-sm text-muted">
                {fillWords(w.customerSees, { text: row.summary })} ·{" "}
                {row.customer
                  ? fillWords(w.signedIn, {
                      name: row.customer.name || row.customer.email,
                    })
                  : w.notSignedIn}{" "}
                ·{" "}
                <Link
                  href={`${base}/support?c=${row.conversationId}`}
                  className="underline"
                >
                  {w.open}
                </Link>
              </p>
              {which === "decided" ? (
                <p className="text-sm">
                  {row.status === "done" ? w.done : w.declinedStatus}
                  {row.decidedBy
                    ? ` ${fillWords(w.by, { name: row.decidedBy })}`
                    : ""}
                  {row.note
                    ? ` · ${fillWords(w.noteIs, { note: row.note })}`
                    : ""}
                </p>
              ) : (
                (decide || carryOut) && (
                  <RequestActions
                    request={{
                      id: row.id,
                      kind: row.kind,
                      orderNumber: row.orderNumber,
                      orderId: row.orderId,
                    }}
                    choice={choices[row.id] ?? null}
                    base={base}
                    carryOut={carryOut ? carryOut(row.id) : null}
                    decide={decide ? decide(row.id) : null}
                  />
                )
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ago(iso: string, now: Date, w: SupportMessages["requests"]): string {
  const minutes = Math.max(
    0,
    Math.round((now.getTime() - Date.parse(iso)) / 60_000),
  );
  if (minutes < 60) return fillWords(w.minutesAgo, { n: minutes });
  const hours = Math.round(minutes / 60);
  if (hours < 48) return fillWords(w.hoursAgo, { n: hours });
  return fillWords(w.daysAgo, { n: Math.round(hours / 24) });
}
