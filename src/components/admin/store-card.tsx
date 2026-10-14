import Link from "next/link";

import { changeText, hidden, money, type StoreFigures } from "@/lib/control-center";
import { storeBase, storeHref } from "@/lib/paths";

import { CARD_CLASS, Chip } from "./ui";

const PAYMENTS = { off: "Payments off", test: "Test payments", live: "Live payments", setup: "Payments need setup" } as const;

function Figure({ label, value, sub, href }: { label: string; value: string; sub?: string | null; href?: string }) {
  const body = (
    <>
      <span className="text-xs text-muted">{label}</span>
      <span className="text-title text-ink tabular-nums [overflow-wrap:anywhere]">{value}</span>
      {sub && <span className="text-xs text-muted">{sub}</span>}
    </>
  );
  return href ? (
    <Link href={href} className="flex min-w-0 flex-col rounded-panel p-2 hover:bg-sunken">
      {body}
    </Link>
  ) : (
    <div className="flex min-w-0 flex-col p-2">{body}</div>
  );
}

/**
 * One store on the control center (D107): its state and figures for the last
 * 7 days, each figure leading to the page that acts on it, and the ways in.
 */
export function StoreCard({ store }: { store: StoreFigures }) {
  const base = `/admin/${store.slug}`;
  const sales = store.sales[0];
  const orders = store.sales.reduce((sum, f) => sum + f.orders, 0);
  // What this member's role does not open is left out, never drawn as a zero.
  const noSales = hidden(store, "sales");
  const noStock = hidden(store, "stock");
  const noPlan = hidden(store, "plan");
  return (
    <article aria-labelledby={`store-${store.slug}`} className={`flex flex-col gap-3 p-5 ${CARD_CLASS}`}>
      <div className="flex flex-wrap items-center gap-2">
        <h3 id={`store-${store.slug}`} className="min-w-0 truncate text-title text-ink">
          <Link href={base} className="hover:underline">
            {store.name}
          </Link>
        </h3>
        {store.role === "admin" && <Chip>Staff</Chip>}
        {store.suspended && (
          <Chip signal="warning" dot>
            Suspended
          </Chip>
        )}
        {!store.open && (
          <Chip signal="warning" dot>
            Not open yet
          </Chip>
        )}
        <span className="ml-auto flex flex-wrap gap-2">
          {!noPlan && (
            <Chip signal={store.plan && ["past_due", "unpaid"].includes(store.plan.status) ? "warning" : "neutral"}>
              {store.plan ? `${store.plan.name}${["past_due", "unpaid"].includes(store.plan.status) ? " · overdue" : ""}` : "No plan"}
            </Chip>
          )}
          <Chip signal={store.payments === "setup" && !store.website ? "warning" : store.payments === "live" && !store.website ? "positive" : "neutral"}>
            {store.website ? "Website" : PAYMENTS[store.payments]}
          </Chip>
        </span>
      </div>
      {noSales && noStock ? null : (
      <div className="grid grid-cols-2 gap-1 sm:grid-cols-[minmax(0,1.7fr)_repeat(3,minmax(0,1fr))]">
        {!noSales && (<>
        <Figure
          label="Sales, 7 days"
          value={sales ? money(sales.week, sales.currency) : "–"}
          sub={sales ? (store.sales.length > 1 ? `+ ${store.sales.length - 1} more ${store.sales.length === 2 ? "currency" : "currencies"}` : changeText(sales.week, sales.prior)) : "No sales yet"}
          href={`${base}/orders`}
        />
        <Figure label="Orders, 7 days" value={String(orders)} href={`${base}/orders`} />
        <Figure label="To send" value={String(store.toSend)} href={`${base}/orders?show=to-send`} />
        </>)}
        {!noStock && <Figure label="Running low" value={String(store.lowStock + store.belowLevel)} sub={store.outOfStock > 0 ? `${store.outOfStock} out of stock` : store.owedUnits > 0 ? `${store.owedUnits} owed on backorder` : null} href={store.belowLevel > 0 ? `${base}/inventory?status=low` : `${base}/products`} />}
      </div>
      )}
      <nav aria-label={`${store.name} shortcuts`} className="flex flex-wrap gap-x-4 gap-y-1 border-t border-line pt-3 text-body">
        <Link href={base} className="font-medium underline">
          Open admin
        </Link>
        {!store.website && (
          <>
            <Link href={`${base}/orders`} className="underline">
              Orders
            </Link>
            <Link href={`${base}/products`} className="underline">
              Products
            </Link>
          </>
        )}
        {store.role === "owner" && (
          <Link href={`${base}/assistant`} className="underline">
            AI manager
          </Link>
        )}
        <Link href={storeHref(store.slug, storeBase(store.slug))} className="ml-auto underline">
          View store
        </Link>
      </nav>
    </article>
  );
}
