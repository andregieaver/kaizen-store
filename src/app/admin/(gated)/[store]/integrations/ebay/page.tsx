import type { Metadata } from "next";
import { Suspense } from "react";
import { sql } from "drizzle-orm";
import { z } from "zod";

import { AdminTextScope } from "@/components/admin/admin-text";
import { DataSkeleton } from "@/components/admin/data/page-parts";
import { card, hint, tableShell, td, th } from "@/components/admin/data/ui";
import { EbayButton, EbayMarkSent, EbayProducts, EbaySettingsForm } from "@/components/admin/ebay-parts";
import { PageHeader } from "@/components/admin/ui";
import { fillWords } from "@/lib/admin-fill";
import { ADMIN_LANG_FACTS, adminLangOf } from "@/lib/admin-lang";
import { adminText, adminTexts } from "@/lib/admin-text";
import { formatMoney } from "@/lib/money";
import { ebayOffered, getEbayConnection, listMarketplaceOrders } from "@/server/ebay";
import { memberCan, requirePermission } from "@/server/permissions";
import { col, typedRows } from "@/server/typed-rows";

import { chooseForEbayAction, connectEbayAction, disconnectEbayAction, markEbaySentAction, saveEbaySettingsAction } from "./actions";

export const metadata: Metadata = { title: "eBay" };

type Props = PageProps<"/admin/[store]/integrations/ebay">;

/** eBay as a sales channel (D555): connect, what eBay needs, the products listed there and the orders from it. Read per request. */
export default async function EbayPage({ params, searchParams }: Props) {
  const gated = await requirePermission((await params).store, "settings:read");
  const lang = adminLangOf(gated.account.adminLocale);
  const w = adminText(lang, "notifications").integrations.ebay;
  const outcome = (await searchParams).ebay;
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={w.title} description={w.intro} />
      {typeof outcome === "string" && outcome in w.outcomes && (
        <p role="status" className="text-sm">
          {w.outcomes[outcome as keyof typeof w.outcomes]}
        </p>
      )}
      <Suspense fallback={<DataSkeleton />}>
        <Body storeSlug={gated.store.slug} />
      </Suspense>
    </div>
  );
}

async function Body({ storeSlug }: { storeSlug: string }) {
  const member = await requirePermission(storeSlug, "settings:read");
  const { store } = member;
  const lang = adminLangOf(member.account.adminLocale);
  const w = adminText(lang, "notifications").integrations.ebay;
  const isOwner = memberCan(member, "owner");
  const connection = await getEbayConnection(store.id);
  if (!ebayOffered() && !connection) return <p className={`${card} text-sm`}>{w.notOffered}</p>;
  if (!connection || connection.state === "off") {
    return isOwner ? <EbayButton text={w.connect} tone="primary" act={connectEbayAction.bind(null, store.slug)} /> : <p className={hint}>{w.notOffered}</p>;
  }
  const [orders, products] = await Promise.all([
    listMarketplaceOrders(store.id),
    typedRows(
      z.object({ variant_id: col.uuid, name: col.text, sku: col.text, state: col.textOrNull, error: col.textOrNull }),
      sql`select v.id as variant_id,
                 coalesce((select t.title from commerce.product_translations t where t.store_id = v.store_id and t.product_id = v.product_id order by t.locale limit 1), v.sku) as name,
                 v.sku, l.state, l.error
          from commerce.product_variants v
          join commerce.products p on p.store_id = v.store_id and p.id = v.product_id and p.status = 'active' and p.kind = 'goods'
          left join commerce.marketplace_listings l on l.connection_id = ${connection.id}::uuid and l.variant_id = v.id
          where v.store_id = ${store.id}::uuid and v.delivery = 'physical' and v.sku is not null and v.active
          order by (l.state is null), name, v.sku limit 300`,
    ),
  ]);
  const locale = ADMIN_LANG_FACTS[lang].locale;
  return (
    <AdminTextScope texts={adminTexts(lang, ["notifications"])}>
      <div className="flex flex-col gap-6">
        <div className={`${card} flex flex-wrap items-center gap-3`}>
          <span className="text-sm font-medium">{connection.state === "connected" ? w.connected : w.refused}</span>
          {connection.lastSyncedAt && <span className={hint}>{fillWords(w.lastSynced, { when: new Date(connection.lastSyncedAt).toLocaleString(locale, { timeZone: store.timeZone }) })}</span>}
          {connection.lastError && <span className="text-sm text-danger-text">{connection.lastError}</span>}
          {isOwner && connection.state === "refused" && <EbayButton text={w.reconnect} tone="primary" act={connectEbayAction.bind(null, store.slug)} />}
          {isOwner && <EbayButton text={w.disconnect} act={disconnectEbayAction.bind(null, store.slug)} />}
        </div>
        {isOwner && <EbaySettingsForm initial={(connection.settings ?? {}) as Record<string, string>} save={saveEbaySettingsAction.bind(null, store.slug)} />}
        {isOwner && connection.settings && (
          <EbayProducts
            rows={products.map((p) => ({ variantId: p.variant_id, name: p.name, sku: p.sku, state: (p.state as "pending" | "listed" | "error" | "ended" | null) ?? null, error: p.error }))}
            choose={chooseForEbayAction.bind(null, store.slug)}
          />
        )}
        <section className="flex flex-col gap-3" aria-labelledby="ebay-orders">
          <h2 id="ebay-orders" className="text-title text-ink">
            {w.ordersTitle}
          </h2>
          {orders.length === 0 ? (
            <p className={hint}>{w.ordersNone}</p>
          ) : (
            <div className={tableShell}>
              <table className="w-full text-sm">
                <caption className="sr-only">{w.ordersTitle}</caption>
                <thead>
                  <tr className="border-b border-line">
                    <th scope="col" className={th}>{w.order}</th>
                    <th scope="col" className={th}>{w.buyer}</th>
                    <th scope="col" className={`${th} text-right`}>{w.total}</th>
                    <th scope="col" className={th}>
                      <span className="sr-only">{w.markSent}</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {orders.map((o) => (
                    <tr key={o.id} className="border-b border-line last:border-0">
                      <td className={td}>
                        <span className="font-medium">{o.externalId}</span>
                        <span className={`${hint} block`}>{new Date(o.placedAt).toLocaleDateString(locale, { timeZone: store.timeZone })}</span>
                        <ul className={hint}>
                          {o.lines.map((l) => (
                            <li key={l.lineItemId}>
                              {l.quantity} × {l.title}
                              {l.sku ? ` (${l.sku})` : ""}
                            </li>
                          ))}
                        </ul>
                        {o.error && <span className="block text-xs text-danger-text">{o.error}</span>}
                      </td>
                      <td className={td}>
                        {o.buyerName}
                        <span className={`${hint} block`}>{[o.shipTo.line1, [o.shipTo.postalCode, o.shipTo.city].filter(Boolean).join(" "), o.shipTo.country].filter(Boolean).join(", ")}</span>
                      </td>
                      <td className={`${td} text-right tabular-nums`}>{formatMoney(o.totalMinor, o.currency, locale)}</td>
                      <td className={td}>
                        {o.state === "open" && isOwner ? (
                          <EbayMarkSent mark={markEbaySentAction.bind(null, store.slug, o.id)} />
                        ) : (
                          <span>
                            {w.states[o.state]}
                            {o.trackingNumber ? ` · ${o.carrier} ${o.trackingNumber}` : ""}
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </AdminTextScope>
  );
}
