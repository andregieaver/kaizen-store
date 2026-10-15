import type { Metadata } from "next";
import { connection } from "next/server";

import { formatBps, priceLabel, SUBSCRIPTION_LABELS } from "@/lib/plans";
import { listStoreBilling } from "@/server/billing";
import { requirePlatformAdmin } from "@/server/auth";
import { Card, Chip, List, ListRow, PageHeader, RowAmount, RowFact, RowLead } from "@/components/admin/ui";

export const metadata: Metadata = { title: "Stores" };

/** Every store with its plan, subscription and fee. */
export default async function PlatformStoresPage() {
  // Per request: admin pages never read the database while the site is built.
  await connection();
  await requirePlatformAdmin();
  const stores = await listStoreBilling({ includeClosed: true });
  return (
    <>
      <PageHeader
        title="Stores"
        description={<>Each store&apos;s plan with Kaizena Flow and its fee per sale. Open a store to start, change or cancel its plan, or give it its own fee.</>}
      />
      <Card compact>
        <List label="Stores">
          {stores.map((store) => (
            <ListRow key={store.storeId}>
              <RowLead
                title={store.name}
                href={`/admin/platform/stores/${store.slug}`}
                sub={
                  <>
                    {store.slug} · {store.ownerEmail ? (store.ownerName ? `${store.ownerName}, ${store.ownerEmail}` : store.ownerEmail) : "No owner yet"}
                  </>
                }
              />
              <RowFact
                sub={[
                  store.status ? (SUBSCRIPTION_LABELS[store.status] ?? store.status) : null,
                  store.cancelAtPeriodEnd && "ends at period end",
                  store.mode === "test" && "test mode",
                  store.currentPeriodEnd && !store.cancelAtPeriodEnd && store.status !== "canceled" && `next invoice ${store.currentPeriodEnd.slice(0, 10)}`,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              >
                {store.planName ? `${store.planName}${store.price ? `, ${priceLabel(store.price.amountMinor, store.price.currency, store.price.interval)}` : ""}` : "No plan"}
              </RowFact>
              {store.storeStatus !== "active" && (
                <Chip signal={store.storeStatus === "closed" ? "neutral" : "danger"} dot>
                  {store.storeStatus === "closed" ? "Closed" : "Suspended"}
                </Chip>
              )}
              <RowAmount>
                {formatBps(store.feeBps)} a sale
                {store.saleFeeBpsOverride !== null && <span className="block text-caption text-muted">own fee</span>}
              </RowAmount>
            </ListRow>
          ))}
        </List>
      </Card>
    </>
  );
}
