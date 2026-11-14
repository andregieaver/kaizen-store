import { askedAlert } from "@/lib/briefing-actions";
import { Check } from "lucide-react";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import { AfterSaleNote } from "@/components/admin/after-sale-gate";
import { BriefingOffer } from "@/components/admin/briefing-offer";
import { StoreDraftsSection } from "@/components/admin/store-drafts-section";
import { AdminTextScope } from "@/components/admin/admin-text";
import { BasicViewHint } from "@/components/admin/admin-view";
import { DemoContentCard } from "@/components/admin/demo-content-card";
import { HomeAnalyticsAlerts, HomeAnalyticsAlertsFallback } from "@/components/admin/analytics/home-alerts";
import { StaffAlertsFailed } from "@/components/admin/notifications/staff-alerts-failed";
import { AskCard } from "@/components/admin/home/ask-card";
import { DotChip, HomeCard, HomeColumns, HomeHeader, Initials, LinkRow, MilestoneTrack, NextUp, Pictures, ProgressRing, WeekBars } from "@/components/admin/home/home-parts";
import { AdminLink, Chip } from "@/components/admin/ui";
import { CARD_CLASS } from "@/components/admin/ui/card";
import { countWords, fillWords } from "@/lib/admin-fill";
import { docsUrl } from "@/lib/docs-host";
import { barHeights, firstName, homeSummary, milestoneTrack, partOfDay, weekChip, whenWords, withoutStoreName } from "@/lib/home";
import { formatMoney } from "@/lib/money";
import { orderPreviews, ordersToSend, paidOrderCount, weekSales } from "@/server/home";
import { ADMIN_LANG_FACTS, adminLangOf } from "@/lib/admin-lang";
import { adminText, adminTexts } from "@/lib/admin-text";
import { attentionFor, hidden } from "@/lib/control-center";
import { demoTotal, demoWords } from "@/lib/demo-content";
import { featureOn } from "@/lib/store-features";
import { memberCan, requireMemberAny } from "@/server/permissions";
import { controlCenter } from "@/server/control-center";
import { demoContent } from "@/server/demo-content";
import { getSetupProgress } from "@/server/setup";
import { latestDreamRun } from "@/server/dream-factory";
import { platformModes } from "@/server/stripe";

import { removeDemoContentAction } from "./demo-actions";
import { shopifyClosedAction } from "./settings/moving/actions";
import { MoveWatchCard } from "@/components/admin/moving/move-watch-card";
import { TodayCard } from "@/components/admin/activities/today-card";
import { activityDoneAction } from "./deals/activity-actions";
import { dismissBriefingAction, turnOnBriefingAction } from "./settings/notifications/staff/actions";

type Props = PageProps<"/admin/[store]">;

export default async function AdminOverview({ params, searchParams }: Props) {
  const current = await requireMemberAny((await params).store);
  const { account, store } = current;
  // A new owner's first stop is the setup wizard.
  // A store template (D175) is never opened, so its owners are not sent to the setup wizard.
  if (!store.setupCompletedAt && !store.starter && memberCan(current, "owner")) {
    // A store the Dream Factory is building (D409) opens on its run; any other on the setup wizard.
    const dream = await latestDreamRun(store.id);
    redirect(`/admin/${store.slug}/${dream && dream.status !== "stopped" ? "dream-factory" : "setup"}`);
  }

  const owner = memberCan(current, "owner");
  const lang = adminLangOf(account.adminLocale);
  const locale = ADMIN_LANG_FACTS[lang].locale;
  const words = adminText(lang, "home");
  const { store: h } = words;
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
  const base = `/admin/${store.slug}`;
  // After the member is known, so the clock is read in a request (the page is not prerendered).
  const now = new Date();
  // A website (D178 step 5: the online shop off) sells nothing: no sales figures, latest orders or selling steps to set up.
  const selling = featureOn(store, "shop");
  const steps = [
    { key: "details" as const, done: progress.details, label: h.steps.details, step: "details" },
    { key: "countries" as const, done: progress.countries, label: selling ? h.steps.countriesSold : h.steps.countries, step: "countries" },
    ...(selling
      ? [
          { key: "shipping" as const, done: progress.shipping, label: h.steps.shipping, href: "settings/shipping" },
          { key: "checkout" as const, done: progress.paymentsOn, label: h.steps.checkout, href: "settings/payments" },
          // Real payments only once Kaizen itself is live; test payments need no setup.
          ...(platformModes().includes("live")
            ? [{ key: "stripe" as const, done: progress.payments, label: h.steps.stripe, href: "settings/payments" }]
            : []),
        ]
      : []),
    // Kaizena Flow's own store has no plan (D466).
    ...(store.house ? [] : [{ key: "plan" as const, done: progress.plan, label: h.steps.plan, href: "billing" }]),
    ...(selling
      ? [
          {
            key: "products" as const,
            done: progress.products,
            label: progress.counts.demoProducts > 0 ? h.steps.replaceDemo : h.steps.products,
            step: "products",
          },
        ]
      : []),
  ];
  const remaining = steps.filter((s) => !s.done).length;

  // The redesigned Home (admin redesign round 1, `docs/audits/admin-redesign-round-1.md`): a greeting and one sentence, the one next step,
  // the week as a picture, what needs a look, milestones; every card it had before is kept, lower down or in the aside.
  const t = words.today;
  const salesHidden = !figures || hidden(figures, "sales");
  const ordersVisible = selling && memberCan(current, "orders:read") && !salesHidden;
  const [week, toSendIds, latestPreviews, orderCount] = ordersVisible
    ? await Promise.all([
        weekSales(store.id, store.timeZone, now),
        ordersToSend(store.id, 100),
        orderPreviews(store.id, center.latest.slice(0, 5).map((o) => o.id)),
        paidOrderCount(store.id),
      ])
    : [null, [] as string[], [], 0];
  const packPreviews = toSendIds.length > 0 ? await orderPreviews(store.id, toSendIds.slice(0, 4)) : [];
  const toSend = figures?.toSend ?? 0;
  const show = (minor: number, currency: string) => formatMoney(minor, currency, locale, { decimals: "hide_whole" });
  const weekTotal = week ? week.days.reduce((sum, d) => sum + d.total, 0) : 0;
  const priorTotal = week ? week.prior.reduce((sum, d) => sum + d.total, 0) : 0;
  const weekOrders = week ? week.days.reduce((sum, d) => sum + d.orders, 0) : 0;
  const priorOrdersCount = week ? week.prior.reduce((sum, d) => sum + d.orders, 0) : 0;
  const summary = store.setupCompletedAt
    ? homeSummary({ toSend: ordersVisible ? toSend : 0, week: weekTotal, prior: priorTotal, amount: week ? show(weekTotal, week.currency) : null }, t, locale)
    : { lead: null, rest: "" };
  const name = firstName(account.name);
  const greeting = name ? fillWords(t.greeting[partOfDay(now, store.timeZone)], { name }) : store.name;
  const dateText = now.toLocaleDateString(locale, { weekday: "long", day: "numeric", month: "long", timeZone: store.timeZone });
  const needs = attention
    .filter((item) => !(toSend > 0 && item.href.endsWith("/orders?show=to-send")))
    .map((item) => ({ ...item, text: withoutStoreName(item.text, store.name) }));
  const nextStep = steps.find((s) => !s.done);
  const stepHref = (step: (typeof steps)[number]) => `${base}/${"href" in step ? step.href : `setup/${step.step}`}`;
  // A store that sells and has had no sale yet, with steps left, opens on its path to opening (the first week).
  const firstWeek = Boolean(store.setupCompletedAt && owner && selling && remaining > 0 && orderCount === 0 && !salesHidden);
  const dayName = (day: string) => new Date(`${day}T12:00:00Z`).toLocaleDateString(locale, { weekday: "short", timeZone: "UTC" });
  const heights = week ? barHeights(week.days.map((d) => d.total), week.prior.map((d) => d.total), 160) : null;
  const chip = week ? weekChip(weekTotal, priorTotal, t, locale) : null;
  const milestones = milestoneTrack(orderCount);
  const docs = (path: string) => docsUrl(`owners/${path}`, lang === "nb" ? "nb" : "en");

  const nextUp =
    ordersVisible && toSend > 0 ? (
      <NextUp
        eyebrow={t.nextUp}
        title={countWords(toSend, t.packTitle)}
        text={[
          toSend === packPreviews.length ? countWords(packPreviews.reduce((sum, o) => sum + o.items, 0), t.packItems) : "",
          packPreviews[0] ? fillWords(t.oldest, { when: whenWords(packPreviews[0].placedAt, now, store.timeZone, t.when) }) : "",
        ]
          .filter(Boolean)
          .join(" ")}
        action={{ href: `${base}/orders?show=to-send`, label: t.startPacking }}
        second={{ href: `${base}/orders/packing-slips?ids=${toSendIds.join(",")}`, label: t.packingSlips, print: true }}
      >
        <ul className="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(min(130px,100%),1fr))]">
          {packPreviews.map((order) => {
            const when = whenWords(order.placedAt, now, store.timeZone, t.when);
            const waiting = when !== t.when.today;
            return (
              <li key={order.id}>
                <AdminLink href={`${base}/orders/${order.id}`} className="flex h-full flex-col gap-3 rounded-card bg-sunken p-3.5 hover:ring-1 hover:ring-edge">
                  <Pictures lines={order.lines} moreWord={(n) => fillWords(t.more, { n })} />
                  <span className="flex flex-col">
                    <span className="text-body-strong text-ink">{order.name ?? `#${order.number}`}</span>
                    <span className="text-caption text-muted">{[order.city, countWords(order.items, t.items)].filter(Boolean).join(" · ")}</span>
                  </span>
                  <span className={`flex items-center gap-1.5 text-caption ${waiting ? "text-warning-text" : "text-muted"}`}>
                    {waiting && <span aria-hidden className="size-1.5 rounded-pill bg-warning-solid" />}
                    {fillWords(waiting ? t.waitingSince : t.placed, { when })}
                  </span>
                </AdminLink>
              </li>
            );
          })}
        </ul>
      </NextUp>
    ) : owner && nextStep ? (
      <NextUp
        eyebrow={t.nextUp}
        title={t.first.steps[nextStep.key].title}
        text={t.first.steps[nextStep.key].text}
        action={{ href: stepHref(nextStep), label: t.first.steps[nextStep.key].action }}
      />
    ) : needs[0] ? (
      <NextUp eyebrow={t.nextUp} title={needs[0].text} action={{ href: needs[0].href, label: needs[0].action }} />
    ) : (
      <NextUp
        eyebrow={t.nextUp}
        title={t.caughtUp}
        text={t.caughtUpText}
        action={selling && memberCan(current, "products:write") ? { href: `${base}/products/new`, label: t.addProduct } : undefined}
      />
    );
  const restNeeds = nextUp && !(ordersVisible && toSend > 0) && !(owner && nextStep) ? needs.slice(1) : needs;

  const setupCard = remaining > 0 && owner && nextStep && (
    <section aria-label={h.finish} className={`${CARD_CLASS} flex items-center gap-3.5 p-5`}>
      <ProgressRing done={steps.length - remaining} total={steps.length} label={fillWords(t.setupDone, { done: steps.length - remaining, total: steps.length })} />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="text-body-strong text-ink">{t.setup}</span>
        <span className="text-caption text-ink-2">{fillWords(t.setupNext, { step: nextStep.label })}</span>
      </span>
      <AdminLink href={stepHref(nextStep)} className="text-body text-brand-text hover:underline">
        {t.continue} ›
      </AdminLink>
    </section>
  );

  const needsCard = store.setupCompletedAt && (
    <HomeCard title={t.needs} compact>
      {restNeeds.length === 0 ? (
        <p className="text-body text-muted">{selling ? h.nothingShop : h.nothing}</p>
      ) : (
        <ul className="flex flex-col">
          {restNeeds.slice(0, 6).map((item) => (
            <LinkRow
              key={`${item.href}-${item.text}`}
              href={item.href}
              start={
                <span aria-hidden className={`size-2 shrink-0 rounded-pill ${item.urgent ? "bg-danger-solid" : "bg-warning-solid"}`} />
              }
              title={<span className="whitespace-normal">{item.text}</span>}
              end={<span className="shrink-0 text-body text-brand-text">{item.action} ›</span>}
            />
          ))}
        </ul>
      )}
    </HomeCard>
  );

  const weekCard = week && heights && chip && (
    <section aria-labelledby="week-heading" className={`${CARD_CLASS} flex flex-col gap-5 p-6 sm:p-7`}>
      <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-3">
        <div className="flex flex-col gap-1.5">
          <h2 id="week-heading" className="text-title text-ink">
            {t.week}
          </h2>
          <div className="flex flex-wrap items-baseline gap-3">
            <span className="text-metric-lg text-ink">{show(weekTotal, week.currency)}</span>
            <span className={`inline-flex h-6.5 items-center rounded-pill px-2.5 text-caption ${chip.good === true ? "bg-positive-soft text-positive-text" : chip.good === false ? "bg-warning-soft text-warning-text" : "bg-neutral-soft text-neutral-text"}`}>
              {chip.text}
            </span>
          </div>
          <span className="text-caption text-muted">{fillWords(t.weekSub, { amount: show(priorTotal, week.currency) })}</span>
        </div>
        <dl className="flex gap-8">
          <div className="flex flex-col gap-0.5">
            <dt className="text-caption text-muted">{t.orders}</dt>
            <dd className="text-metric text-ink">{weekOrders}</dd>
            <dd className="text-caption text-muted">{fillWords(t.lastWeek, { value: priorOrdersCount })}</dd>
          </div>
          {weekOrders > 0 && (
            <div className="flex flex-col gap-0.5">
              <dt className="text-caption text-muted">{t.averageOrder}</dt>
              <dd className="text-metric text-ink">{show(Math.round(weekTotal / weekOrders), week.currency)}</dd>
              {priorOrdersCount > 0 && <dd className="text-caption text-muted">{fillWords(t.lastWeek, { value: show(Math.round(priorTotal / priorOrdersCount), week.currency) })}</dd>}
            </div>
          )}
        </dl>
      </div>
      <WeekBars
        heights={heights.days}
        priorHeights={heights.prior}
        dayNames={week.days.map((d, i) => (i === week.days.length - 1 ? t.todayLabel : dayName(d.day)))}
        todayAmount={show(week.days[week.days.length - 1].total, week.currency)}
        label={fillWords(t.chartLabel, { amount: show(week.days[week.days.length - 1].total, week.currency) })}
        keys={{ now: t.thisWeekKey, before: t.lastWeekKey }}
        link={memberCan(current, "analytics:read") ? { href: `${base}/analytics`, label: t.openAnalytics } : undefined}
      />
    </section>
  );

  const latestCard = ordersVisible && center.latest.length > 0 && (
    <HomeCard title={t.latest} link={{ href: `${base}/orders`, label: t.allOrders }}>
      <ul className="flex flex-col">
        {center.latest.slice(0, 5).map((order) => {
          const preview = latestPreviews.find((p) => p.id === order.id);
          const toSendNow = order.status === "paid";
          return (
            <LinkRow
              key={order.id}
              href={`${base}/orders/${order.id}`}
              start={<Initials name={order.name ?? order.number} strong={toSendNow} />}
              title={order.name ?? `#${order.number}`}
              sub={[whenWords(order.placedAt, now, store.timeZone, t.when), preview?.city].filter(Boolean).join(" · ")}
              end={
                <span className="flex shrink-0 items-center gap-3">
                  {preview && <span className="hidden sm:block"><Pictures lines={preview.lines} size={32} max={2} moreWord={(n) => fillWords(t.more, { n })} /></span>}
                  <Chip signal={toSendNow ? "warning" : order.status === "fulfilled" || order.status === "closed" ? "positive" : undefined}>
                    {statuses[order.status as keyof typeof statuses] ?? order.status}
                  </Chip>
                  <span className="w-24 text-right text-body text-ink tabular-nums">{show(order.totalMinor, order.currency)}</span>
                </span>
              }
            />
          );
        })}
      </ul>
    </HomeCard>
  );

  const milestoneCard = ordersVisible && orderCount > 0 && (
    <HomeCard title={t.milestones} compact>
      <p className="flex items-baseline gap-2">
        <span className="text-metric text-ink">{orderCount.toLocaleString(locale)}</span>
        <span className="text-body text-ink-2">{countWords(orderCount, t.ordersSoFar)}</span>
      </p>
      <MilestoneTrack
        share={milestones.share}
        marks={milestones.marks}
        label={milestones.next ? fillWords(t.toNext, { n: milestones.next - orderCount, target: milestones.next }) : t.allReached}
        firstSale={t.firstSale}
      />
      <p className="text-caption text-muted">{milestones.next ? fillWords(t.toNext, { n: milestones.next - orderCount, target: milestones.next }) : t.allReached}</p>
    </HomeCard>
  );

  const askCard = owner && store.status === "active" && (
    <AskCard title={t.ask} placeholder={t.askPlaceholder} asks={t.asks} />
  );

  const demoCard = owner && <DemoContentCard summary={demoSummary} action={removeDemoContentAction.bind(null, store.slug)} words={words.demo} />;

  const firstWeekPath = firstWeek && nextStep && (
    <section aria-labelledby="path-step" className={`${CARD_CLASS} flex flex-col gap-7 p-6 sm:p-7`}>
      <ol className="grid gap-2 [grid-template-columns:repeat(auto-fit,minmax(min(96px,100%),1fr))]">
        {steps.map((step) => {
          const current = step === nextStep;
          return (
            <li key={step.label} aria-current={current ? "step" : undefined} className="flex flex-col items-center gap-2.5 text-center">
              <span
                className={`flex size-12 items-center justify-center rounded-pill ${step.done ? "bg-brand text-brand-ink" : current ? "bg-inverse text-inverse-ink ring-6 ring-brand-soft" : "bg-sunken text-ink-2"}`}
              >
                {step.done ? <Check aria-hidden className="size-5" /> : <span className="text-body-strong">{steps.indexOf(step) + 1}</span>}
              </span>
              <span className={`text-caption ${current ? "font-medium text-ink" : "text-ink-2"}`}>
                <span className="sr-only">{step.done ? h.done : h.toDo}</span>
                {t.first.steps[step.key].short}
              </span>
            </li>
          );
        })}
      </ol>
      <div role="img" aria-label={fillWords(t.setupDone, { done: steps.length - remaining, total: steps.length })} className="relative -mt-3 h-1.5 rounded-pill bg-sunken">
        <span style={{ width: `${Math.round(((steps.length - remaining) / steps.length) * 100)}%` }} className="absolute inset-y-0 left-0 rounded-pill bg-brand" />
      </div>
      <div className="flex flex-col gap-2.5 rounded-card bg-sunken p-6 sm:p-7">
        <p className="text-eyebrow text-muted uppercase">{fillWords(t.first.stepOf, { n: steps.indexOf(nextStep) + 1, total: steps.length })}</p>
        <h2 id="path-step" className="text-metric text-ink">
          {t.first.steps[nextStep.key].title}
        </h2>
        <p className="max-w-xl text-body-lg text-ink-2">{t.first.steps[nextStep.key].text}</p>
        <div className="mt-1.5 flex flex-wrap gap-2">
          <AdminLink href={stepHref(nextStep)} className="inline-flex h-11 items-center gap-2 rounded-pill bg-brand px-5 text-body-strong text-brand-ink hover:bg-brand-hover">
            {t.first.steps[nextStep.key].action} →
          </AdminLink>
        </div>
      </div>
    </section>
  );

  const afterCards = firstWeek && (
    <section aria-label={t.first.after.title} className="grid gap-4 sm:grid-cols-3">
      {(["buy", "hear", "money"] as const).map((key) => (
        <div key={key} className={`${CARD_CLASS} flex flex-col gap-2 p-5`}>
          <span className="text-body-strong text-ink">{t.first.after[key].title}</span>
          <span className="text-caption leading-relaxed text-ink-2">{t.first.after[key].text}</span>
        </div>
      ))}
    </section>
  );

  const firstWeekAside = firstWeek && (
    <>
      {!store.starter && (
        <section aria-label={t.first.describe} className="flex flex-col gap-2.5 rounded-card bg-insight-soft p-5">
          <h2 className="text-body-strong text-insight-text">{t.first.describe}</h2>
          <p className="text-body text-ink">{t.first.describeText}</p>
          <AdminLink href={`${base}/dream-factory`} className="inline-flex h-10 items-center justify-center rounded-pill bg-inverse px-4 text-body text-inverse-ink hover:opacity-90">
            {t.first.describeButton}
          </AdminLink>
        </section>
      )}
      <HomeCard title={t.first.learn} compact>
        <ul className="flex flex-col">
          {(
            [
              ["product", "getting-started/your-first-product"],
              ["vat", "markets-and-tax/vat"],
              ["around", "getting-started/find-your-way"],
            ] as const
          ).map(([key, path]) => (
            <li key={key} className="border-t border-line first:border-t-0">
              <a href={docs(path)} className="flex min-h-11 items-center justify-between gap-3 py-2 text-body text-ink hover:underline">
                {t.first.articles[key]}
                <span aria-hidden className="text-muted">↗</span>
              </a>
            </li>
          ))}
        </ul>
      </HomeCard>
    </>
  );

  return (
    <div className="flex flex-col gap-6">
      <HomeHeader
        eyebrow={fillWords(t.eyebrow, { date: dateText })}
        title={firstWeek ? (name ? fillWords(t.first.title, { name, store: store.name }) : fillWords(t.first.titlePlain, { store: store.name })) : greeting}
        lead={firstWeek ? null : summary.lead}
        rest={firstWeek ? t.first.text : summary.rest}
        chips={
          <>
            {store.setupCompletedAt ? <DotChip tone="positive">{t.open}</DotChip> : <DotChip tone="warning">{h.notOpenYet}</DotChip>}
            {selling && store.paymentsTest && <DotChip tone="neutral">{t.testPayments}</DotChip>}
          </>
        }
      />
      {!store.setupCompletedAt && (
        <p role="status" className="text-body text-muted">
          {h.notOpenText}
        </p>
      )}
      {/* A store drafted from one description (D351): its drafts, or the form while it is being set up; read after the page is shown. */}
      {memberCan(current, "website:write") && (
        <AdminTextScope texts={adminTexts(lang, ["home"])}>
          <Suspense fallback={null}>
            <StoreDraftsSection storeId={store.id} storeSlug={store.slug} offerStart={!store.setupCompletedAt} />
          </Suspense>
        </AdminTextScope>
      )}
      {/* A website keeps Orders out of the menu, but reachable while an order can still be withdrawn from or returned (D178 step 5). */}
      <AfterSaleNote store={store} />
      <HomeColumns
        main={
          <>
            {firstWeek ? firstWeekPath : store.setupCompletedAt ? nextUp : null}
            {firstWeek ? afterCards : weekCard}
            {/* Today's calls, meetings and tasks (S3, D468), the viewer's or the team's: read after the page is shown. */}
            {store.setupCompletedAt && featureOn(store, "sales") && memberCan(current, "customers:read") && (
              <Suspense fallback={null}>
                <TodayCard
                  member={current}
                  team={(await searchParams).today === "team"}
                  lang={lang}
                  done={memberCan(current, "customers:write") ? (id, done) => activityDoneAction.bind(null, store.slug, id, done) : null}
                />
              </Suspense>
            )}
            {latestCard}
            {/* What Analytics found: its own reports are read after the page is shown, and a failure leaves it out. */}
            {store.setupCompletedAt && selling && memberCan(current, "analytics:read") && (
              <Suspense fallback={<HomeAnalyticsAlertsFallback />}>
                <HomeAnalyticsAlerts store={store} base={base} now={now} lang={lang} ask={askedAlert((await searchParams).ask)} />
              </Suspense>
            )}
            {/* The 14 days after a move from Shopify (D445 step 7c): the owner's card, read after the page is shown. */}
            {store.setupCompletedAt && owner && (
              <Suspense fallback={null}>
                <MoveWatchCard member={current} lang={lang} close={shopifyClosedAction.bind(null, store.slug)} />
              </Suspense>
            )}
            {/* Staff alerts that gave up after their tries (D238): the owner's to look at, read after the page is shown. */}
            {store.setupCompletedAt && selling && memberCan(current, "owner") && (
              <Suspense fallback={null}>
                <StaffAlertsFailed storeId={store.id} href={`${base}/settings/notifications/staff`} words={adminText(lang, "notifications")} />
              </Suspense>
            )}
          </>
        }
        aside={
          <>
            {firstWeek ? firstWeekAside : setupCard}
            {!firstWeek && needsCard}
            {!firstWeek && askCard}
            {!firstWeek && milestoneCard}
            {demoCard}
          </>
        }
      />
      <div className="flex flex-col gap-4 border-t border-line pt-4">
        {/* An open store is changed with the Dream Factory too (D527): the owner says what to change, and nothing goes live before their press. */}
        {store.setupCompletedAt && owner && !store.starter && !firstWeek && (
          <p className="text-body text-muted">
            <AdminLink href={`${base}/dream-factory`} className="underline">
              {words.dream.rework.offer}
            </AdminLink>
          </p>
        )}
        {/* The briefing by email, offered once to an owner (D348): read after the page is shown. */}
        {store.setupCompletedAt && selling && owner && (
          <Suspense fallback={null}>
            <BriefingOffer storeId={store.id} lang={lang} turnOn={turnOnBriefingAction.bind(null, store.slug)} dismiss={dismissBriefingAction.bind(null, store.slug)} />
          </Suspense>
        )}
        {/* Home has no sidebar to say it (D454): in the Basic view, where the rest of the admin is and the switch to it. */}
        <BasicViewHint card />
      </div>
    </div>
  );
}
