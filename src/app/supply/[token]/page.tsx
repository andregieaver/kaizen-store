import type { Metadata } from "next";
import { connection } from "next/server";
import { Suspense } from "react";

import { fillWords } from "@/lib/admin-fill";
import { SUPPLIER_CARRIERS, SUPPLIER_PROBLEM_MAX, supplierWords, type SupplierWords } from "@/lib/supplier-orders";
import { supplierOrderByToken } from "@/server/supplier-orders";

import { postParcelAction, reportProblemAction } from "./actions";

export const metadata: Metadata = { title: "Order to send", robots: { index: false, follow: false } };

type Props = PageProps<"/supply/[token]">;

const CARRIER_NAMES: Record<string, string> = { posten: "Posten", bring: "Bring", postnord: "PostNord", dhl: "DHL", dhl_paket: "DHL Paket", ups: "UPS", instabox: "Instabox" };

const field = "min-h-11 rounded-md border border-line bg-card px-3";
const button = "min-h-11 self-start rounded-full bg-foreground px-5 font-medium text-background";

/**
 * A drop-shipping supplier's page (D541, `docs/drop-shipping.md` 5), reached from its order email's link: what to send and where, the store's
 * note, and two answers, the parcel sent (carrier and tracking) or why it cannot send. Nothing else of the store and no other order; the link is
 * the only key and ends after 60 days. In the language the store chose for the supplier. Read per request, never cached.
 */
export default function SupplyPage({ params, searchParams }: Props) {
  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-6 px-4 py-10">
      <Suspense fallback={<div className="h-40 animate-pulse rounded-lg bg-surface" />}>
        <Body params={params} searchParams={searchParams} />
      </Suspense>
    </main>
  );
}

const problemText = (w: SupplierWords, code: string): string | null =>
  ({ tracking: w.badTracking, carrier: w.badTracking, link: w.badLink, refused: w.refused, reason: w.badReason, done: w.alreadySent, cancelled: w.cancelled, gone: w.gone })[code] ?? null;

async function Body({ params, searchParams }: Pick<Props, "params" | "searchParams">) {
  await connection();
  const { token } = await params;
  const query = await searchParams;
  const order = await supplierOrderByToken(token);
  if (!order) {
    const w = supplierWords("en");
    return <p role="alert">{w.gone}</p>;
  }
  const w = supplierWords(order.language);
  const facts = { store: order.storeName, number: order.number };
  const done = typeof query.done === "string" ? query.done : null;
  const problem = typeof query.problem === "string" ? problemText(w, query.problem) : null;
  const open = (order.state === "sent" || order.state === "problem") && order.orderPaid;
  return (
    <div lang={order.language} className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <h1 className="text-3xl tracking-tight">{fillWords(w.pageTitle, facts)}</h1>
        {open && <p className="text-muted">{fillWords(w.pageIntro, facts)}</p>}
      </header>
      {done === "sent" && <p role="status">{w.sentDone}</p>}
      {done === "problem" && <p role="status">{fillWords(w.problemDone, facts)}</p>}
      {problem && <p role="alert" className="text-danger-text">{fillWords(problem, facts)}</p>}
      {order.state === "shipped" && done !== "sent" && <p role="status">{w.alreadySent}</p>}
      {(order.state === "cancelled" || !order.orderPaid) && <p role="alert">{w.cancelled}</p>}

      <section aria-labelledby="send" className="flex flex-col gap-2">
        <h2 id="send" className="text-lg font-medium">{w.send}</h2>
        <table className="w-full text-left">
          <thead>
            <tr className="border-b border-line">
              <th scope="col" className="py-2"><span className="sr-only">{w.send}</span></th>
              <th scope="col" className="py-2">SKU</th>
              <th scope="col" className="py-2 text-right">{w.quantity}</th>
            </tr>
          </thead>
          <tbody>
            {order.lines.map((line, i) => (
              <tr key={i} className="border-b border-line">
                <td className="py-2">{line.title}</td>
                <td className="py-2 text-muted">{line.sku ?? ""}</td>
                <td className="py-2 text-right tabular-nums">{line.quantity}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {open && (
        <>
          <section aria-labelledby="ship-to" className="flex flex-col gap-1">
            <h2 id="ship-to" className="text-lg font-medium">{w.shipTo}</h2>
            <address className="not-italic">
              {order.shipTo.map((line, i) => (
                <span key={i} className="block">{line}</span>
              ))}
            </address>
          </section>
          {order.note && (
            <section aria-labelledby="note" className="flex flex-col gap-1">
              <h2 id="note" className="text-lg font-medium">{fillWords(w.note, facts)}</h2>
              <p className="whitespace-pre-line">{order.note}</p>
            </section>
          )}
          <form action={postParcelAction.bind(null, token)} className="flex flex-col gap-3 rounded-lg bg-surface p-4" aria-labelledby="mark-sent">
            <h2 id="mark-sent" className="text-lg font-medium">{w.markSent}</h2>
            <label className="flex flex-col gap-1">
              <span>{w.carrier}</span>
              <select name="carrier" required defaultValue="posten" className={field}>
                {SUPPLIER_CARRIERS.map((c) => (
                  <option key={c} value={c}>{c === "other" ? w.other : CARRIER_NAMES[c]}</option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span>{w.tracking}</span>
              <input name="tracking" required minLength={3} maxLength={60} autoComplete="off" className={field} />
            </label>
            <label className="flex flex-col gap-1">
              <span>{w.trackingUrl}</span>
              <input name="trackingUrl" type="url" maxLength={500} placeholder="https://" className={field} />
            </label>
            <button type="submit" className={button}>{w.markSent}</button>
          </form>
          <form action={reportProblemAction.bind(null, token)} className="flex flex-col gap-3 rounded-lg border border-line p-4" aria-labelledby="cannot-send">
            <h2 id="cannot-send" className="text-lg font-medium">{w.cannotSend}</h2>
            <p className="text-muted">{fillWords(w.cannotSendIntro, facts)}</p>
            <label className="flex flex-col gap-1">
              <span>{w.reason}</span>
              <textarea name="reason" required minLength={3} maxLength={SUPPLIER_PROBLEM_MAX} rows={3} className={`${field} py-2`} />
            </label>
            <button type="submit" className="min-h-11 self-start rounded-full border border-line px-5">{fillWords(w.reportProblem, facts)}</button>
          </form>
        </>
      )}
    </div>
  );
}
