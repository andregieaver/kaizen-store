import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { storesOf } from "@/components/admin/admin-shell-parts";
import { Attention, Section, Stat, StatGrid } from "@/components/admin/overview-parts";
import { StoreCard } from "@/components/admin/store-card";
import { ButtonLink, Card, Chip, List, ListRow, PageHeader, RowAmount, RowDate, RowId, RowText } from "@/components/admin/ui";
import { attentionFor, changeText, money, totalSales } from "@/lib/control-center";
import { ORDER_STATUS_LABELS } from "@/lib/order-status";
import { requireAccount } from "@/server/auth";
import { controlCenter } from "@/server/control-center";
import { listHostings } from "@/server/hosts";

export const metadata: Metadata = { title: "Control center" };

/**
 * The store owner's control center (D107): every store they run at a glance,
 * what needs them first, the week's figures and the latest orders. Where
 * someone has no stores of their own to run, the way in is the place they
 * work: their store, the platform, or their hosting.
 */
export default async function ControlCenterPage() {
  const account = await requireAccount();
  const [stores, hostings] = await Promise.all([storesOf(account), listHostings(account)]);
  const owner = stores.some((store) => store.role === "owner");
  if (!owner) {
    if (stores.length === 1 && hostings.length === 0 && !account.platformAdmin) redirect(`/admin/${stores[0].slug}`);
    if (stores.length > 0) redirect("/admin/stores");
    if (hostings.length > 0) redirect("/admin/hosting");
    if (account.platformAdmin) redirect("/admin/platform");
    return (
      <PageHeader title="Control center" meta={["You do not have access to any store yet"]} />
    );
  }

  const center = await controlCenter(account);
  const attention = attentionFor(center.stores);
  const sales = totalSales(center.stores);
  const orders = sales.reduce((sum, f) => sum + f.orders, 0);
  const priorOrders = sales.reduce((sum, f) => sum + f.priorOrders, 0);
  const toSend = center.stores.reduce((sum, s) => sum + s.toSend, 0);
  const low = center.stores.reduce((sum, s) => sum + s.lowStock + s.belowLevel, 0);

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        eyebrow="Home"
        title="Control center"
        meta={[center.stores.length === 1 ? "Your store at a glance" : `All ${center.stores.length} stores you work in, at a glance`]}
        actions={
          <ButtonLink href="/admin/stores" size="header">
            Manage stores
          </ButtonLink>
        }
      />

      <Attention items={attention} empty="Nothing needs you right now. Every order is sent, stock is fine and plans are paid." />

      <Section id="week-heading" title="The last 7 days">
        <StatGrid>
          {sales.length === 0 ? <Stat label="Sales" value="–" sub="No sales yet" /> : sales.slice(0, 2).map((f) => <Stat key={f.currency} label={`Sales (${f.currency})`} value={money(f.week, f.currency)} sub={changeText(f.week, f.prior)} />)}
          <Stat label="Orders" value={orders} sub={changeText(orders, priorOrders)} />
          <Stat label="Waiting to be sent" value={toSend} sub={toSend > 0 ? "Across your stores" : "All sent"} />
          {sales.length < 2 && <Stat label="Products running low" value={low} sub={low > 0 ? "3 or fewer, or at your own level" : "Stock is fine"} />}
          {center.ai.requests > 0 && sales.length < 2 && <Stat label="AI requests" value={center.ai.requests} sub={center.ai.failed > 0 ? `${center.ai.failed} failed` : undefined} href="/admin/account/usage" />}
        </StatGrid>
      </Section>

      <Section id="stores-heading" title="Your stores" action={<ButtonLink kind="link" href="/admin/stores">All stores</ButtonLink>}>
        <div className="grid gap-4 xl:grid-cols-2">
          {center.stores.map((store) => (
            <StoreCard key={store.slug} store={store} />
          ))}
        </div>
      </Section>

      {center.latest.length > 0 && (
        <Card title="Latest orders">
          <List label="Latest orders">
            {center.latest.map((order) => (
              <ListRow key={order.id} href={`/admin/${order.storeSlug}/orders/${order.id}`}>
                <RowId>#{order.number}</RowId>
                <RowText>
                  {order.storeName}
                  {order.name ? ` · ${order.name}` : ""}
                </RowText>
                <Chip>{ORDER_STATUS_LABELS[order.status as keyof typeof ORDER_STATUS_LABELS] ?? order.status}</Chip>
                <RowDate>
                  <time dateTime={order.placedAt}>{order.placedAt.slice(0, 10)}</time>
                </RowDate>
                <RowAmount>{money(order.totalMinor, order.currency)}</RowAmount>
              </ListRow>
            ))}
          </List>
        </Card>
      )}

      {hostings.length > 0 && (
        <Card title="Hosting">
          <List label="Hosting">
            {hostings.map((h) => (
              <ListRow key={h.slug} href={`/admin/hosting/${h.slug}`}>
                <RowId>{h.name}</RowId>
                <RowText>As {h.hostName}</RowText>
              </ListRow>
            ))}
          </List>
        </Card>
      )}
    </div>
  );
}
