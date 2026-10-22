import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import { AfterSaleNote } from "@/components/admin/after-sale-gate";
import { DemoContentCard } from "@/components/admin/demo-content-card";
import { HomeAnalyticsAlerts, HomeAnalyticsAlertsFallback } from "@/components/admin/analytics/home-alerts";
import { StaffAlertsFailed } from "@/components/admin/notifications/staff-alerts-failed";
import { Attention, Section, Stat, StatGrid } from "@/components/admin/overview-parts";
import { ButtonLink, Card, Chip, List, ListRow, PageHeader, RowAmount, RowDate, RowId, RowText } from "@/components/admin/ui";
import { fillWords } from "@/lib/admin-fill";
import { ADMIN_LANG_FACTS, adminLangOf } from "@/lib/admin-lang";
import { adminText } from "@/lib/admin-text";
import { attentionFor, changeText, hidden, money, totalSales } from "@/lib/control-center";
import { demoTotal, demoWords } from "@/lib/demo-content";
import { featureOn } from "@/lib/store-features";
import { memberCan, requireMemberAny } from "@/server/permissions";
import { controlCenter } from "@/server/control-center";
import { demoContent } from "@/server/demo-content";
import { getSetupProgress } from "@/server/setup";
import { platformModes } from "@/server/stripe";

import { removeDemoContentAction } from "./demo-actions";

type Props = PageProps<"/admin/[store]">;

export default async function AdminOverview({ params }: Props) {
  const current = await requireMemberAny((await params).store);
  const { account, store } = current;
  // A new owner's first stop is the setup wizard.
  // A store template (D175) is never opened, so its owners are not sent to the setup wizard.
  if (!store.setupCompletedAt && !store.starter && memberCan(current, "owner")) redirect(`/admin/${store.slug}/setup`);

  const owner = memberCan(current, "owner");
  const lang = adminLangOf(account.adminLocale);
  const locale = ADMIN_LANG_FACTS[lang].locale;
  const words = adminText(lang, "home");
  const { common: c, store: h } = words;
  const statuses = adminText(lang, "common").orderStatus;
  const [progress, center, demo] = await Promise.all([
    getSetupProgress(store),
    controlCenter(account, store.slug),
    // What the store template brought and the owner has not changed (`docs/theme-showcase-phase-1.md` step 4b): theirs to remove.
    owner ? demoContent(store.id, store.localization.locales[0] ?? "en") : null,
  ]);
  const demoSummary =
    demo && demoTotal(demo.counts) > 0
      ? { words: demoWords(demo.counts, words.demo), items: demo.items.map(({ noun, title }) => ({ noun, title })), changed: demo.changed.map(({ noun, title }) => ({ noun, title })) }
      : null;
  const figures = center.stores[0];
  const attention = figures ? attentionFor([figures], undefined, words.attention) : [];
  const sales = figures ? totalSales([figures]) : [];
  const orders = sales.reduce((sum, f) => sum + f.orders, 0);
  const priorOrders = sales.reduce((sum, f) => sum + f.priorOrders, 0);
  const base = `/admin/${store.slug}`;
  // After the member is known, so the clock is read in a request (the page is not prerendered).
  const now = new Date();
  // A website (D178 step 5: the online shop off) sells nothing: no sales figures, latest orders or selling steps to set up.
  const selling = featureOn(store, "shop");
  const steps = [
    { done: progress.details, label: h.steps.details, step: "details" },
    { done: progress.countries, label: selling ? h.steps.countriesSold : h.steps.countries, step: "countries" },
    ...(selling
      ? [
          { done: progress.shipping, label: h.steps.shipping, href: "settings/shipping" },
          { done: progress.paymentsOn, label: h.steps.checkout, href: "settings/payments" },
          // Real payments only once Kaizen itself is live; test payments need no setup.
          ...(platformModes().includes("live")
            ? [{ done: progress.payments, label: h.steps.stripe, href: "settings/payments" }]
            : []),
        ]
      : []),
    { done: progress.plan, label: h.steps.plan, href: "billing" },
    ...(selling
      ? [
          {
            done: progress.products,
            label: progress.counts.demoProducts > 0 ? h.steps.replaceDemo : h.steps.products,
            step: "products",
          },
        ]
      : []),
  ];
  const remaining = steps.filter((s) => !s.done).length;

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        eyebrow={c.eyebrow}
        status={store.setupCompletedAt ? undefined : <Chip signal="warning" dot>{h.notOpenYet}</Chip>}
        title={store.name}
        meta={[selling ? h.onlineShop : h.website, fillWords(h.overviewOf, { date: now.toLocaleDateString(locale, { day: "numeric", month: "long" }) })]}
      />
      {!store.setupCompletedAt && (
        <p role="status" className="text-body text-muted">
          {h.notOpenText}
        </p>
      )}
      {/* Setup has its own checklist below; what else needs someone is listed here. */}
      {/* A website keeps Orders out of the menu, but reachable while an order can still be withdrawn from or returned (D178 step 5). */}
      <AfterSaleNote store={store} />
      {store.setupCompletedAt && <Attention items={attention} empty={selling ? h.nothingShop : h.nothing} words={words.attention} />}
      {/* Staff alerts that gave up after their tries (D238): the owner's to look at, read after the page is shown. */}
      {store.setupCompletedAt && selling && memberCan(current, "owner") && (
        <Suspense fallback={null}>
          <StaffAlertsFailed storeId={store.id} href={`${base}/settings/notifications/staff`} words={adminText(lang, "notifications")} />
        </Suspense>
      )}
      {/* What Analytics found: its own reports are read after the page is shown, and a failure leaves it out. */}
      {store.setupCompletedAt && selling && memberCan(current, "analytics:read") && (
        <Suspense fallback={<HomeAnalyticsAlertsFallback />}>
          <HomeAnalyticsAlerts store={store} base={base} now={now} />
        </Suspense>
      )}
      {store.setupCompletedAt && selling && !(figures && hidden(figures, "sales") && hidden(figures, "stock")) && (
        <Section id="week-heading" title={c.week}>
          <StatGrid>
            {figures && hidden(figures, "sales") ? null : sales.length === 0 ? <Stat label={c.sales} value="–" sub={c.noSales} href={`${base}/orders`} /> : sales.slice(0, 2).map((f) => <Stat key={f.currency} label={fillWords(c.salesIn, { currency: f.currency })} value={money(f.week, f.currency, locale)} sub={changeText(f.week, f.prior, c)} href={`${base}/orders`} />)}
            {!(figures && hidden(figures, "sales")) && <Stat label={c.orders} value={orders} sub={changeText(orders, priorOrders, c)} href={`${base}/orders`} />}
            {!(figures && hidden(figures, "sales")) && <Stat label={c.waitingToBeSent} value={figures?.toSend ?? 0} href={`${base}/orders?show=to-send`} />}
            {!(figures && hidden(figures, "stock")) && <Stat label={c.runningLow} value={figures?.lowStock ?? 0} sub={figures && figures.outOfStock > 0 ? fillWords(h.outOfStock, { n: figures.outOfStock }) : undefined} href={`${base}/products`} />}
            {!(figures && hidden(figures, "stock")) && figures && figures.belowLevel > 0 && <Stat label={h.atOrBelow} value={figures.belowLevel} sub={h.atOrBelowSub} href={`${base}/inventory?status=low`} />}
            {!(figures && hidden(figures, "stock")) && figures && figures.owedUnits > 0 && <Stat label={h.owed} value={figures.owedUnits} sub={h.owedSub} href={`${base}/inventory?status=backorder`} />}
          </StatGrid>
        </Section>
      )}
      {store.setupCompletedAt && selling && center.latest.length > 0 && (
        <Card title={c.latestOrders} aside={<ButtonLink kind="link" href={`${base}/orders`}>{h.allOrders}</ButtonLink>}>
          <List label={c.latestOrders}>
            {center.latest.map((order) => (
              <ListRow key={order.id} href={`${base}/orders/${order.id}`}>
                <RowId>#{order.number}</RowId>
                <RowText>{order.name ?? ""}</RowText>
                <Chip>{statuses[order.status as keyof typeof statuses] ?? order.status}</Chip>
                <RowDate>
                  <time dateTime={order.placedAt}>{order.placedAt.slice(0, 10)}</time>
                </RowDate>
                <RowAmount>{money(order.totalMinor, order.currency, locale)}</RowAmount>
              </ListRow>
            ))}
          </List>
        </Card>
      )}
      {owner && <DemoContentCard summary={demoSummary} action={removeDemoContentAction.bind(null, store.slug)} words={words.demo} />}
      {remaining > 0 && (
        <Card title={h.finish} aside={fillWords(h.doneOf, { done: steps.length - remaining, total: steps.length })}>
          <ol className="flex flex-col gap-2 text-body">
            {steps.map((step) => (
              <li key={step.label} className="flex items-baseline gap-2">
                <span aria-hidden="true">{step.done ? "✓" : "○"}</span>
                <span className="flex-1">
                  <span className="sr-only">{step.done ? h.done : h.toDo}</span>
                  {step.label}
                </span>
                {!step.done && memberCan(current, "owner") && (
                  <Link
                    href={`/admin/${store.slug}/${"href" in step ? step.href : `setup/${step.step}`}`}
                    className="underline"
                  >
                    {h.doItNow}
                  </Link>
                )}
              </li>
            ))}
          </ol>
        </Card>
      )}
    </div>
  );
}
