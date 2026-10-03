import Link from "next/link";

import type { ReturnKind, ReturnStatus } from "@/lib/return-status";

import type { R } from "./withdraw-parts";

/** An order's return as the order pages list it (`listOrderReturns()`). */
export type OrderReturnItem = { number: string; kind: ReturnKind; status: ReturnStatus; token: string };

const PAID = new Set(["paid", "fulfilled", "closed"]);

/**
 * Whether the order page offers the withdrawal function: a paid order of goods for a consumer. Anything else is left to the
 * function's own page, which says why (it is also in the footer and in every order email), so nothing is hidden by saying
 * nothing, but an order with no goods or for a company is not nagged.
 */
export const offersWithdrawal = (order: { status: string; ships: boolean; company: unknown }): boolean =>
  PAID.has(order.status) && order.ships && !order.company;

/** The address of the withdrawal function for an order: its number, and the order page's own key when the visitor has it. */
export function withdrawHref(base: string, number: string, key: string | null): string {
  const query = new URLSearchParams({ order: number });
  if (key) query.set("key", key);
  return `${base}/withdraw?${query.toString()}`;
}

/**
 * Withdrawal and returns on an order's page and in My account (D153, `docs/returns.md`): the button into the withdrawal
 * function with the order filled in, and the order's returns, each linking to its status page. Draws nothing for an order
 * with neither. The caller has shown the order is the visitor's (the order page's key, or the signed-in customer).
 */
export function OrderReturns({
  m,
  base,
  order,
  orderKey,
  returns,
}: {
  m: R;
  base: string;
  order: { number: string; status: string; ships: boolean; company: unknown };
  /** The order page's key: given to the function so it can show the order's lines; null in My account, where signing in is the proof. */
  orderKey: string | null;
  returns: OrderReturnItem[];
}) {
  const offer = offersWithdrawal(order);
  if (!offer && returns.length === 0) return null;
  return (
    <section aria-labelledby="order-returns-heading" className="flex flex-col gap-3 rounded-lg border border-border p-4">
      <h2 id="order-returns-heading" className="font-medium">
        {m.orderHeading}
      </h2>
      {offer && (
        <>
          <p className="text-sm">{m.orderIntro}</p>
          <Link
            href={withdrawHref(base, order.number, orderKey)}
            className="inline-flex min-h-11 items-center self-start button-primary rounded-button px-5 text-sm font-medium"
          >
            {m.orderLink}
          </Link>
        </>
      )}
      {returns.length > 0 && (
        <div>
          <h3 className="mb-1 text-sm font-medium">{m.yourReturns}</h3>
          <ul className="flex flex-col gap-1">
            {returns.map((r) => (
              <li key={r.token}>
                <Link href={`${base}/returns/${r.token}`} className="underline">
                  {r.number}
                </Link>
                <span className="text-muted">
                  {" "}
                  · {m.kind[r.kind]} · {m.status[r.status]}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
