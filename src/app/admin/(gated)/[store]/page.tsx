import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import { HomeAnalyticsAlerts, HomeAnalyticsAlertsFallback } from "@/components/admin/analytics/home-alerts";
import { Attention, Section, Stat, StatGrid } from "@/components/admin/overview-parts";
import { attentionFor, changeText, hidden, money, totalSales } from "@/lib/control-center";
import { ORDER_STATUS_LABELS } from "@/lib/order-status";
import { memberCan, requireMemberAny } from "@/server/permissions";
import { controlCenter } from "@/server/control-center";
import { getSetupProgress } from "@/server/setup";
import { platformModes } from "@/server/stripe";

type Props = PageProps<"/admin/[store]">;

export default async function AdminOverview({ params }: Props) {
  const current = await requireMemberAny((await params).store);
  const { account, store } = current;
  // A new owner's first stop is the setup wizard.
  if (!store.setupCompletedAt && memberCan(current, "owner")) redirect(`/admin/${store.slug}/setup`);

  const [progress, center] = await Promise.all([getSetupProgress(store), controlCenter(account, store.slug)]);
  const figures = center.stores[0];
  const attention = figures ? attentionFor([figures]) : [];
  const sales = figures ? totalSales([figures]) : [];
  const orders = sales.reduce((sum, f) => sum + f.orders, 0);
  const priorOrders = sales.reduce((sum, f) => sum + f.priorOrders, 0);
  const base = `/admin/${store.slug}`;
  // After the member is known, so the clock is read in a request (the page is not prerendered).
  const now = new Date();
  const steps = [
    { done: progress.details, label: "Business details", step: "details" },
    { done: progress.countries, label: "Countries you sell to", step: "countries" },
    { done: progress.shipping, label: "Shipping prices for every country", href: "settings/shipping" },
    { done: progress.paymentsOn, label: "Checkout switched on, so shoppers can pay", href: "settings/payments" },
    // Real payments only once Kaizen itself is live; test payments need no setup.
    ...(platformModes().includes("live")
      ? [{ done: progress.payments, label: "Stripe set up for real payments", href: "settings/payments" }]
      : []),
    { done: progress.plan, label: "Choose a plan", href: "billing" },
    {
      done: progress.products,
      label: progress.counts.demoProducts > 0 ? "Replace the demo products" : "Products",
      step: "products",
    },
  ];
  const remaining = steps.filter((s) => !s.done).length;

  return (
    <div className="flex flex-col gap-8">
      <h1 className="text-2xl font-semibold">Overview</h1>
      {!store.setupCompletedAt && (
        <p role="status" className="rounded-lg border border-border bg-background p-4 text-sm">
          This store is not open yet. An owner can finish the setup.
        </p>
      )}
      {/* Setup has its own checklist below; what else needs someone is listed here. */}
      {store.setupCompletedAt && <Attention items={attention} empty="Nothing needs you right now. Every order is sent and stock is fine." />}
      {/* What Analytics found: its own reports are read after the page is shown, and a failure leaves it out. */}
      {store.setupCompletedAt && memberCan(current, "analytics:read") && (
        <Suspense fallback={<HomeAnalyticsAlertsFallback />}>
          <HomeAnalyticsAlerts store={store} base={base} now={now} />
        </Suspense>
      )}
      {store.setupCompletedAt && !(figures && hidden(figures, "sales") && hidden(figures, "stock")) && (
        <Section id="week-heading" title="The last 7 days">
          <StatGrid>
            {figures && hidden(figures, "sales") ? null : sales.length === 0 ? <Stat label="Sales" value="–" sub="No sales yet" href={`${base}/orders`} /> : sales.slice(0, 2).map((f) => <Stat key={f.currency} label={`Sales (${f.currency})`} value={money(f.week, f.currency)} sub={changeText(f.week, f.prior)} href={`${base}/orders`} />)}
            {!(figures && hidden(figures, "sales")) && <Stat label="Orders" value={orders} sub={changeText(orders, priorOrders)} href={`${base}/orders`} />}
            {!(figures && hidden(figures, "sales")) && <Stat label="Waiting to be sent" value={figures?.toSend ?? 0} href={`${base}/orders?show=to-send`} />}
            {!(figures && hidden(figures, "stock")) && <Stat label="Products running low" value={figures?.lowStock ?? 0} sub={figures && figures.outOfStock > 0 ? `${figures.outOfStock} out of stock` : undefined} href={`${base}/products`} />}
          </StatGrid>
        </Section>
      )}
      {store.setupCompletedAt && center.latest.length > 0 && (
        <Section id="latest-heading" title="Latest orders" action={<Link href={`${base}/orders`} className="text-sm underline">All orders</Link>}>
          <ul className="divide-y divide-border rounded-lg border border-border bg-background text-sm">
            {center.latest.map((order) => (
              <li key={order.id}>
                <Link href={`${base}/orders/${order.id}`} className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 px-4 py-3 hover:bg-surface">
                  <span className="font-medium">#{order.number}</span>
                  <span className="min-w-0 flex-1 truncate text-muted">{order.name ?? ""}</span>
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
      {remaining > 0 && (
        <section aria-labelledby="checklist-heading" className="rounded-lg border border-border bg-background p-5">
          <h2 id="checklist-heading" className="mb-3 font-medium">
            Finish setting up ({steps.length - remaining} of {steps.length} done)
          </h2>
          <ol className="flex flex-col gap-2 text-sm">
            {steps.map((step) => (
              <li key={step.label} className="flex items-baseline gap-2">
                <span aria-hidden="true">{step.done ? "✓" : "○"}</span>
                <span className="flex-1">
                  <span className="sr-only">{step.done ? "Done: " : "To do: "}</span>
                  {step.label}
                </span>
                {!step.done && memberCan(current, "owner") && (
                  <Link
                    href={`/admin/${store.slug}/${"href" in step ? step.href : `setup/${step.step}`}`}
                    className="underline"
                  >
                    Do it now
                  </Link>
                )}
              </li>
            ))}
          </ol>
        </section>
      )}
    </div>
  );
}
