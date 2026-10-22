import Link from "next/link";

import { countWords, fillWords } from "@/lib/admin-fill";
import { homeEn, type HomeMessages } from "@/lib/admin-messages/home.en";
import { changeText, hidden, money, type StoreFigures } from "@/lib/control-center";
import { storeBase, storeHref } from "@/lib/paths";

import { CARD_CLASS, Chip } from "./ui";


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
export function StoreCard({
  store,
  words = homeEn,
  locale = "en",
}: {
  store: StoreFigures;
  /** The `home` catalogue in the account's language (D312 A3), and its number format. */
  words?: HomeMessages;
  locale?: string;
}) {
  const w = words.card;
  const payments = { off: w.paymentsOff, test: w.paymentsTest, live: w.paymentsLive, setup: w.paymentsSetup }[store.payments];
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
        {store.role === "admin" && <Chip>{w.staff}</Chip>}
        {store.suspended && (
          <Chip signal="warning" dot>
            {w.suspended}
          </Chip>
        )}
        {!store.open && (
          <Chip signal="warning" dot>
            {w.notOpenYet}
          </Chip>
        )}
        <span className="ml-auto flex flex-wrap gap-2">
          {!noPlan && (
            <Chip signal={store.plan && ["past_due", "unpaid"].includes(store.plan.status) ? "warning" : "neutral"}>
              {store.plan ? `${store.plan.name}${["past_due", "unpaid"].includes(store.plan.status) ? w.overdue : ""}` : w.noPlan}
            </Chip>
          )}
          <Chip signal={store.payments === "setup" && !store.website ? "warning" : store.payments === "live" && !store.website ? "positive" : "neutral"}>
            {store.website ? w.website : payments}
          </Chip>
        </span>
      </div>
      {noSales && noStock ? null : (
      <div className="grid grid-cols-2 gap-1 sm:grid-cols-[minmax(0,1.7fr)_repeat(3,minmax(0,1fr))]">
        {!noSales && (<>
        <Figure
          label={w.sales}
          value={sales ? money(sales.week, sales.currency, locale) : "–"}
          sub={sales ? (store.sales.length > 1 ? countWords(store.sales.length - 1, w.moreCurrencies) : changeText(sales.week, sales.prior, words.common)) : words.common.noSales}
          href={`${base}/orders`}
        />
        <Figure label={w.orders} value={String(orders)} href={`${base}/orders`} />
        <Figure label={w.toSend} value={String(store.toSend)} href={`${base}/orders?show=to-send`} />
        </>)}
        {!noStock && <Figure label={w.runningLow} value={String(store.lowStock + store.belowLevel)} sub={store.outOfStock > 0 ? fillWords(w.outOfStock, { n: store.outOfStock }) : store.owedUnits > 0 ? fillWords(w.owed, { n: store.owedUnits }) : null} href={store.belowLevel > 0 ? `${base}/inventory?status=low` : `${base}/products`} />}
      </div>
      )}
      <nav aria-label={fillWords(w.shortcuts, { name: store.name })} className="flex flex-wrap gap-x-4 gap-y-1 border-t border-line pt-3 text-body">
        <Link href={base} className="font-medium underline">
          {w.openAdmin}
        </Link>
        {!store.website && (
          <>
            <Link href={`${base}/orders`} className="underline">
              {w.orderLinks}
            </Link>
            <Link href={`${base}/products`} className="underline">
              {w.products}
            </Link>
          </>
        )}
        {store.role === "owner" && (
          <Link href={`${base}/assistant`} className="underline">
            AI manager
          </Link>
        )}
        <Link href={storeHref(store.slug, storeBase(store.slug))} className="ml-auto underline">
          {w.viewStore}
        </Link>
      </nav>
    </article>
  );
}
