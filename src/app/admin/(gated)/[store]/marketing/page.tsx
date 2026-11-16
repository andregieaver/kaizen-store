import type { Metadata } from "next";
import { connection } from "next/server";
import { Mail, ShoppingCart, Tag } from "lucide-react";

import { NavIcon } from "@/components/admin/nav-icons";
import { AdminLink, CARD_CLASS, Chip, PageHeader } from "@/components/admin/ui";
import { countWords, fillWords } from "@/lib/admin-fill";
import { ADMIN_LANG_FACTS, adminLangOf } from "@/lib/admin-lang";
import { navWord } from "@/lib/admin-nav-words";
import { adminText } from "@/lib/admin-text";
import { LIFECYCLE_KINDS } from "@/lib/automations";
import { STATE_SIGNAL } from "@/lib/experiment-list";
import { canOpenPath } from "@/lib/permissions";
import { featureOn } from "@/lib/store-features";
import { STORE_SECTIONS, storeSections } from "@/lib/store-nav";
import { holderOf } from "@/server/auth";
import { automationStats, getAutomations } from "@/server/automations";
import { listCampaigns } from "@/server/campaigns";
import { getCartReminderSettings } from "@/server/cart-reminders";
import { customerCounts } from "@/server/customer-admin";
import { listedTests } from "@/server/experiment-list";
import { bestSellerByCount } from "@/server/marketing-home";
import { subscriberCounts } from "@/server/marketing-subscribers";
import { requirePermission } from "@/server/permissions";

export const metadata: Metadata = { title: "Marketing" };

/**
 * Marketing's first page (round 4, D612): a sentence on what brings people back, ready plays that open their setup (an email after a purchase,
 * cart reminders, a first offer on the best seller), what runs now and what it did in 30 days, the list, a broadcast, and every tool by name.
 */
export default async function MarketingPage({ params }: PageProps<"/admin/[store]/marketing">) {
  // Per request: admin pages never read the database while the site is built.
  await connection();
  const member = await requirePermission((await params).store, "marketing:read");
  const { store } = member;
  const lang = adminLangOf(member.account.adminLocale);
  const w = adminText(lang, "marketing").home;
  const kinds = adminText(lang, "marketing").automations.kinds;
  const say = (text: string) => navWord(lang, text);
  const base = `/admin/${store.slug}`;
  const shop = featureOn(store, "shop");
  const currency = store.markets[0]?.currency ?? "EUR";
  const ex = adminText(lang, "experiments");
  const [automations, stats, cart, campaigns, subscribers, buyers, best, tests] = await Promise.all([
    getAutomations(store),
    automationStats(store.id),
    shop ? getCartReminderSettings(store.id) : Promise.resolve(null),
    shop ? listCampaigns(store.id) : Promise.resolve([]),
    subscriberCounts(store.id),
    customerCounts(store.id, currency),
    shop ? bestSellerByCount(store.id) : Promise.resolve(null),
    listedTests(store, { words: ex, numberLocale: ADMIN_LANG_FACTS[lang].locale }),
  ]);
  const n = (v: number) => v.toLocaleString(ADMIN_LANG_FACTS[lang].locale);

  // What runs now, each with what it did in 30 days: the automations that are on, cart reminders, the campaigns that are on.
  const running = [
    ...LIFECYCLE_KINDS.filter((kind) => automations[kind].enabled).map((kind) => ({
      key: kind,
      title: kinds[kind].title,
      sub: w.automation,
      href: `${base}/automations/${kind}`,
      did: countWords(stats.sent[kind], w.sent),
    })),
    ...(cart?.enabled ? [{ key: "cart", title: w.cart.title, sub: w.cartRow, href: `${base}/cart-reminders`, did: countWords(cart.steps.filter((s) => s.active).length, w.steps) }] : []),
    ...campaigns.filter((c) => c.active).map((c) => ({ key: c.id, title: c.name, sub: w.campaignRow, href: `${base}/campaigns/${c.id}`, did: countWords(c.orders, w.orders) })),
  ];
  // The A/B tests that run (phase 15): each with its stage, so one with an answer is seen here too. They bring no one back, so the lead leaves them out.
  const testing = tests
    .filter((t) => t.status === "running")
    .map((t) => ({ key: t.id, title: t.name, sub: w.testRow, href: `${base}/experiments/${t.id}`, did: countWords(t.exposed, w.testVisitors, { n: n(t.exposed) }), state: t.card.state }));
  const lead =
    (running.length === 0 ? w.leadNothing : countWords(running.length, w.leadRunning)) +
    (buyers.people === 0 ? w.leadNoBuyers : countWords(buyers.fresh, w.leadBuyers) + (buyers.back > 0 ? countWords(buyers.back, w.leadBack) : w.leadNoneBack));

  // The plays that are not running yet, each opening the page that sets it up.
  const plays = [
    ...(!automations.after_purchase.enabled ? [{ key: "after", icon: Mail, tone: "bg-positive-soft text-positive-text", ...w.after, href: `${base}/automations/after_purchase` }] : []),
    ...(shop && !cart?.enabled ? [{ key: "cart", icon: ShoppingCart, tone: "bg-warning-soft text-warning-text", ...w.cart, href: `${base}/cart-reminders` }] : []),
    ...(shop && !campaigns.some((c) => c.active)
      ? [{ key: "offer", icon: Tag, tone: "bg-insight-soft text-insight-text", ...w.offer, does: best ? fillWords(w.offer.does, { product: best.title }) : w.offer.doesNone, href: `${base}/campaigns/new` }]
      : []),
  ];

  const holder = holderOf(member);
  const section = storeSections(store, (path) => canOpenPath(holder, path)).find((s) => s.key === "marketing") ?? STORE_SECTIONS.find((s) => s.key === "marketing")!;
  const tools = section.groups.flatMap((g) => g.items);
  const listed = subscribers.subscribed;

  return (
    <div className="flex flex-col gap-7">
      <PageHeader title={w.title} meta={[lead]} />

      {plays.length > 0 && (
        <section aria-labelledby="plays" className="flex flex-col gap-3">
          <h2 id="plays" className="text-title text-ink">
            {w.plays} <span className="text-caption font-normal text-muted">{w.playsSub}</span>
          </h2>
          <ul className="grid grid-cols-[repeat(auto-fit,minmax(min(17rem,100%),1fr))] gap-3">
            {plays.map((play, i) => (
              <li key={play.key} className={`flex flex-col gap-3 p-5.5 ${CARD_CLASS}`}>
                <span aria-hidden className={`flex size-11 items-center justify-center rounded-card ${play.tone}`}>
                  <play.icon className="size-5" />
                </span>
                <h3 className="text-title text-ink">{play.title}</h3>
                <p className="text-body text-ink-2">{play.does}</p>
                <p className="text-caption text-muted">{play.note}</p>
                <AdminLink
                  href={play.href}
                  className={`mt-auto inline-flex h-10 items-center self-start rounded-pill px-4.5 text-body ${i === 0 ? "bg-brand font-medium text-brand-ink" : "border border-edge bg-card text-ink hover:bg-sunken"}`}
                >
                  {play.button}
                </AdminLink>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section aria-labelledby="running" className="flex flex-col gap-3">
        <h2 id="running" className="text-title text-ink">
          {w.running}
        </h2>
        {running.length + testing.length === 0 ? (
          <p className={`px-5 py-4 text-body text-muted ${CARD_CLASS}`}>{w.nothingRunning}</p>
        ) : (
          <div className={`overflow-hidden ${CARD_CLASS}`}>
            <div aria-hidden className="hidden grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)] gap-4 border-b border-line px-5 py-2.5 text-caption text-muted sm:grid">
              <span>{w.what}</span>
              <span>{w.state}</span>
              <span>{w.did}</span>
            </div>
            <ul aria-label={w.running}>
              {[...running.map((row) => ({ ...row, state: null })), ...testing].map((row) => (
                <li key={row.key} className="border-b border-line last:border-b-0">
                  <AdminLink href={row.href} className="grid gap-1 px-5 py-3.5 text-ink hover:bg-sunken sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)] sm:items-center sm:gap-4">
                    <span className="flex flex-col gap-0.5">
                      <span className="text-body">{row.title}</span>
                      <span className="text-caption text-muted">{row.sub}</span>
                    </span>
                    {row.state ? (
                      <span>
                        <Chip signal={STATE_SIGNAL[row.state]} dot>
                          {ex.card.states[row.state]}
                        </Chip>
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1.5 text-caption text-positive-text">
                        <span aria-hidden className="size-1.5 rounded-pill bg-insight-solid" />
                        {w.on}
                      </span>
                    )}
                    <span className="text-body text-ink-2">{row.did}</span>
                  </AdminLink>
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(20rem,100%),1fr))] gap-3">
        <section aria-labelledby="list" className={`flex flex-col gap-2.5 px-5.5 py-5 ${CARD_CLASS}`}>
          <h2 id="list" className="text-body-strong text-ink">
            {w.list}
          </h2>
          <p className="text-[26px] tracking-tight">
            {n(listed)} <span className="text-body tracking-normal text-muted">{listed === 1 ? w.listCount.one : w.listCount.many}</span>
          </p>
          <p className="text-body text-ink-2">{w.listText}</p>
          <AdminLink href={`${base}/subscribers`} className="self-start text-body font-medium text-brand-text underline-offset-2 hover:underline">
            {w.listLink}
          </AdminLink>
        </section>
        <section aria-labelledby="tell" className={`flex flex-col gap-2.5 px-5.5 py-5 ${CARD_CLASS}`}>
          <h2 id="tell" className="text-body-strong text-ink">
            {w.tell}
          </h2>
          <p className="text-body text-ink-2">{w.tellText}</p>
          <AdminLink href={`${base}/broadcasts/new`} className="self-start text-body font-medium text-brand-text underline-offset-2 hover:underline">
            {w.tellLink}
          </AdminLink>
        </section>
      </div>

      <section aria-labelledby="tools" className={`flex flex-col gap-3 px-5.5 py-4.5 ${CARD_CLASS}`}>
        <h2 id="tools" className="text-body-strong text-ink">
          {w.tools} <span className="text-caption font-normal text-muted">{w.toolsSub}</span>
        </h2>
        <ul className="flex flex-wrap gap-2">
          {tools.map((item) => (
            <li key={item.path}>
              <AdminLink href={`${base}${item.path}`} className="inline-flex h-9 items-center gap-2 rounded-pill bg-sunken px-3.5 text-body text-ink hover:bg-line">
                <NavIcon name={item.icon} className="size-3.5 text-ink-2" />
                {say(item.label)}
              </AdminLink>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
