import Link from "next/link";

import { changeText, hidden, money, type StoreFigures } from "@/lib/control-center";
import { storeBase, storeHref } from "@/lib/paths";

const PAYMENTS = { off: "Payments off", test: "Test payments", live: "Live payments", setup: "Payments need setup" } as const;
const chip = "rounded-full border border-border px-2 py-0.5 text-xs text-muted";
const warn = "rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-900 dark:bg-amber-950 dark:text-amber-200";

function Figure({ label, value, sub, href }: { label: string; value: string; sub?: string | null; href?: string }) {
  const body = (
    <>
      <span className="text-xs text-muted">{label}</span>
      <span className="text-lg font-semibold tabular-nums [overflow-wrap:anywhere]">{value}</span>
      {sub && <span className="text-xs text-muted">{sub}</span>}
    </>
  );
  return href ? (
    <Link href={href} className="flex min-w-0 flex-col rounded-md p-2 hover:bg-surface">
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
    <article aria-labelledby={`store-${store.slug}`} className="flex flex-col gap-3 rounded-lg border border-border bg-background p-4">
      <div className="flex flex-wrap items-center gap-2">
        <h3 id={`store-${store.slug}`} className="min-w-0 truncate text-base font-semibold">
          <Link href={base} className="hover:underline">
            {store.name}
          </Link>
        </h3>
        {store.role === "admin" && <span className={chip}>Staff</span>}
        {store.suspended && <span className={warn}>Suspended</span>}
        {!store.open && <span className={warn}>Not open yet</span>}
        {!noPlan && <span className={`${chip} ml-auto`}>{store.plan ? `${store.plan.name}${["past_due", "unpaid"].includes(store.plan.status) ? " · overdue" : ""}` : "No plan"}</span>}
        <span className={`${store.payments === "setup" ? warn : chip}${noPlan ? " ml-auto" : ""}`}>{PAYMENTS[store.payments]}</span>
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
        {!noStock && <Figure label="Running low" value={String(store.lowStock)} sub={store.outOfStock > 0 ? `${store.outOfStock} out of stock` : null} href={`${base}/products`} />}
      </div>
      )}
      <nav aria-label={`${store.name} shortcuts`} className="flex flex-wrap gap-x-4 gap-y-1 border-t border-border pt-3 text-sm">
        <Link href={base} className="font-medium underline">
          Open admin
        </Link>
        <Link href={`${base}/orders`} className="underline">
          Orders
        </Link>
        <Link href={`${base}/products`} className="underline">
          Products
        </Link>
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
