import type { Metadata } from "next";
import { connection } from "next/server";

import { formatBps, priceLabel } from "@/lib/plans";
import { listStoreBilling } from "@/server/billing";
import { requirePlatformAdmin } from "@/server/auth";
import { Card, Chip, List, ListRow, PageHeader, RowAmount, RowFact, RowLead } from "@/components/admin/ui";
import { fillWords } from "@/lib/admin-fill";
import { ADMIN_LANG_FACTS, adminLangOf } from "@/lib/admin-lang";
import { adminText } from "@/lib/admin-text";

export const metadata: Metadata = { title: "Stores" };

/** Every store with its plan, subscription and fee. */
export default async function PlatformStoresPage() {
  // Per request: admin pages never read the database while the site is built.
  await connection();
  const account = await requirePlatformAdmin();
  const lang = adminLangOf(account.adminLocale);
  const w = adminText(lang, "platform").stores;
  const billingWords = adminText(lang, "billing");
  const locale = ADMIN_LANG_FACTS[lang].locale;
  const stores = await listStoreBilling({ includeClosed: true });
  return (
    <>
      <PageHeader
        title={w.title}
        description={w.description}
      />
      <Card compact>
        <List label={w.title}>
          {stores.map((store) => (
            <ListRow key={store.storeId}>
              <RowLead
                title={store.name}
                href={`/admin/platform/stores/${store.slug}`}
                sub={
                  <>
                    {store.slug} · {store.ownerEmail ? (store.ownerName ? `${store.ownerName}, ${store.ownerEmail}` : store.ownerEmail) : w.noOwner}
                  </>
                }
              />
              <RowFact
                sub={[
                  store.status ? (billingWords.statuses[store.status] ?? store.status) : null,
                  store.cancelAtPeriodEnd && w.endsAtPeriodEnd,
                  store.mode === "test" && w.testMode,
                  store.currentPeriodEnd && !store.cancelAtPeriodEnd && store.status !== "canceled" && fillWords(w.nextInvoice, { date: store.currentPeriodEnd.slice(0, 10) }),
                ]
                  .filter(Boolean)
                  .join(" · ")}
              >
                {store.planName ? `${store.planName}${store.price ? `, ${priceLabel(store.price.amountMinor, store.price.currency, store.price.interval, billingWords.intervals)}` : ""}` : w.noPlan}
              </RowFact>
              {store.storeStatus !== "active" && (
                <Chip signal={store.storeStatus === "closed" ? "neutral" : "danger"} dot>
                  {store.storeStatus === "closed" ? w.closed : w.suspended}
                </Chip>
              )}
              <RowAmount>
                {fillWords(w.aSale, { fee: formatBps(store.feeBps, locale) })}
                {store.saleFeeBpsOverride !== null && <span className="block text-caption text-muted">{w.ownFee}</span>}
              </RowAmount>
            </ListRow>
          ))}
        </List>
      </Card>
    </>
  );
}
