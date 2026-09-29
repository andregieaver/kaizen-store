import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { storesOf } from "@/components/admin/admin-shell-parts";
import { Attention, Section, Stat, StatGrid } from "@/components/admin/overview-parts";
import { StoreCard } from "@/components/admin/store-card";
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
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold">Control center</h1>
        <p className="text-sm text-muted">You do not have access to any store yet.</p>
      </div>
    );
  }

  const center = await controlCenter(account);
  const attention = attentionFor(center.stores);
  const sales = totalSales(center.stores);
  const orders = sales.reduce((sum, f) => sum + f.orders, 0);
  const priorOrders = sales.reduce((sum, f) => sum + f.priorOrders, 0);
  const toSend = center.stores.reduce((sum, s) => sum + s.toSend, 0);
  const low = center.stores.reduce((sum, s) => sum + s.lowStock, 0);

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="text-2xl font-semibold">Control center</h1>
        <p className="text-sm text-muted">
          {center.stores.length === 1 ? "Your store" : `All ${center.stores.length} stores you work in`}, at a glance.
        </p>
      </div>

      <Attention items={attention} empty="Nothing needs you right now. Every order is sent, stock is fine and plans are paid." />

      <Section id="week-heading" title="The last 7 days">
        <StatGrid>
          {sales.length === 0 ? <Stat label="Sales" value="–" sub="No sales yet" /> : sales.slice(0, 2).map((f) => <Stat key={f.currency} label={`Sales (${f.currency})`} value={money(f.week, f.currency)} sub={changeText(f.week, f.prior)} />)}
          <Stat label="Orders" value={orders} sub={changeText(orders, priorOrders)} />
          <Stat label="Waiting to be sent" value={toSend} sub={toSend > 0 ? "Across your stores" : "All sent"} />
          {sales.length < 2 && <Stat label="Products running low" value={low} sub={low > 0 ? "Stock of 3 or fewer" : "Stock is fine"} />}
          {center.ai.requests > 0 && sales.length < 2 && <Stat label="AI requests" value={center.ai.requests} sub={center.ai.failed > 0 ? `${center.ai.failed} failed` : undefined} href="/admin/account/usage" />}
        </StatGrid>
      </Section>

      <Section
        id="stores-heading"
        title="Your stores"
        action={
          <Link href="/admin/stores" className="text-sm underline">
            Manage stores
          </Link>
        }
      >
        <div className="grid gap-4 xl:grid-cols-2">
          {center.stores.map((store) => (
            <StoreCard key={store.slug} store={store} />
          ))}
        </div>
      </Section>

      {center.latest.length > 0 && (
        <Section id="latest-heading" title="Latest orders">
          <ul className="divide-y divide-border rounded-lg border border-border bg-background text-sm">
            {center.latest.map((order) => (
              <li key={order.id}>
                <Link href={`/admin/${order.storeSlug}/orders/${order.id}`} className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 px-4 py-3 hover:bg-surface">
                  <span className="font-medium">#{order.number}</span>
                  <span className="min-w-0 flex-1 truncate text-muted">
                    {order.storeName}
                    {order.name ? ` · ${order.name}` : ""}
                  </span>
                  <span className="text-xs text-muted">{ORDER_STATUS_LABELS[order.status as keyof typeof ORDER_STATUS_LABELS] ?? order.status}</span>
                  <time dateTime={order.placedAt} className="hidden text-xs text-muted sm:inline">
                    {order.placedAt.slice(0, 10)}
                  </time>
                  <span className="tabular-nums">{money(order.totalMinor, order.currency)}</span>
                </Link>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {hostings.length > 0 && (
        <Section id="hosting-heading" title="Hosting">
          <ul className="divide-y divide-border rounded-lg border border-border bg-background text-sm">
            {hostings.map((h) => (
              <li key={h.slug} className="p-4">
                <Link href={`/admin/hosting/${h.slug}`} className="font-medium underline-offset-2 hover:underline">
                  {h.name}
                </Link>
                <span className="block text-muted">As {h.hostName}</span>
              </li>
            ))}
          </ul>
        </Section>
      )}
    </div>
  );
}
