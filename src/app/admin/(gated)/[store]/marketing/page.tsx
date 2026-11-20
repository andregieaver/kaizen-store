import type { Metadata } from "next";
import { connection } from "next/server";
import { Mail, ShoppingCart, Tag } from "lucide-react";

import { NavIcon } from "@/components/admin/nav-icons";
import { PhoneMore } from "@/components/admin/phone-more";
import { PHONE_MORE_HIDDEN } from "@/components/admin/phone-more-class";
import { AdminLink, CARD_CLASS, Chip, PageHeader } from "@/components/admin/ui";
import { countWords, fillWords } from "@/lib/admin-fill";
import { ADMIN_LANG_FACTS, adminLangOf } from "@/lib/admin-lang";
import { navWord } from "@/lib/admin-nav-words";
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
import { memberCan, requirePermission } from "@/server/permissions";
import { sendingHealth } from "@/server/sending-guard";
import { noticeState, SendingGuardNotice } from "@/components/admin/sending-guard-notice";
import { ContactPolicyCard } from "@/components/admin/contact-policy-card";
import { getContactPolicy } from "@/server/contact-policy";

import { contactPolicyAction, resumeSendingAction } from "./actions";
import { storeExtensionOn } from "@/lib/extensions";
import { EXPERIMENTS_WORDS } from "@/lib/admin-words/experiments";
import { MARKETING_WORDS } from "@/lib/admin-words/marketing";

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
  const w = MARKETING_WORDS[lang].home;
  const kinds = MARKETING_WORDS[lang].automations.kinds;
  const say = (text: string) => navWord(lang, text);
  const base = `/admin/${store.slug}`;
  const shop = featureOn(store, "shop");
  const currency = store.markets[0]?.currency ?? "EUR";
  const ex = EXPERIMENTS_WORDS[lang];
  // A/B tests and email automation are paid extensions (D748): their parts of the hub are there only while the account has them.
  const abOn = storeExtensionOn(store, "ab_testing");
  const emailOn = storeExtensionOn(store, "email_automation");
  const [automations, stats, cart, campaigns, subscribers, buyers, best, tests, health, policy] = await Promise.all([
    getAutomations(store),
    automationStats(store.id),
    shop ? getCartReminderSettings(store.id) : Promise.resolve(null),
    shop ? listCampaigns(store.id) : Promise.resolve([]),
    subscriberCounts(store.id),
    customerCounts(store.id, currency),
    shop ? bestSellerByCount(store.id) : Promise.resolve(null),
    abOn ? listedTests(store, { words: ex, numberLocale: ADMIN_LANG_FACTS[lang].locale }) : Promise.resolve([]),
    sendingHealth(store.id),
    getContactPolicy(store.id),
  ]);
  const n = (v: number) => v.toLocaleString(ADMIN_LANG_FACTS[lang].locale);

  // What runs now, each with what it did in 30 days: the automations that are on, cart reminders, the campaigns that are on.
  const running = [
    ...LIFECYCLE_KINDS.filter((kind) => emailOn && automations[kind].enabled).map((kind) => ({
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
    ...(emailOn && !automations.after_purchase.enabled ? [{ key: "after", icon: Mail, tone: "bg-positive-soft text-positive-text", ...w.after, short: w.phone.after, href: `${base}/automations/after_purchase` }] : []),
    ...(shop && !cart?.enabled ? [{ key: "cart", icon: ShoppingCart, tone: "bg-warning-soft text-warning-text", ...w.cart, short: w.phone.cart, href: `${base}/cart-reminders` }] : []),
    ...(shop && !campaigns.some((c) => c.active)
      ? [{ key: "offer", icon: Tag, tone: "bg-insight-soft text-insight-text", ...w.offer, does: best ? fillWords(w.offer.does, { product: best.title }) : w.offer.doesNone, short: best ? fillWords(w.phone.offer, { product: best.title }) : w.phone.offerNone, href: `${base}/campaigns/new` }]
      : []),
  ];

  const holder = holderOf(member);
  const section = storeSections(store, (path) => canOpenPath(holder, path, store.workspace)).find((s) => s.key === "marketing") ?? STORE_SECTIONS.find((s) => s.key === "marketing")!;
  const tools = section.groups.flatMap((g) => g.items);
  const listed = subscribers.subscribed;
  // On a phone (round 38, D728) the first six tools show, the rest behind +N.
  const TOOLS_FIRST = 6;

  return (
    <div className="flex flex-col gap-7">
      <PageHeader title={w.title} meta={[lead]} />
      {emailOn && (
        <SendingGuardNotice
          state={noticeState(health)}
          words={MARKETING_WORDS[lang].sendingGuard}
          locale={ADMIN_LANG_FACTS[lang].locale}
          timeZone={store.timeZone}
          resume={memberCan(member, "marketing:write") ? resumeSendingAction.bind(null, store.slug) : null}
        />
      )}

      {plays.length > 0 && (
        <section aria-labelledby="plays" className="flex flex-col gap-3">
          <h2 id="plays" className="text-title text-ink">
            {w.plays} <span className="text-caption font-normal text-muted max-sm:hidden">{w.playsSub}</span>
          </h2>
          {/* On a phone each play is a row of one card: its icon, name, a short line and Set it up (round 38, D728). */}
          <ul className="grid grid-cols-[repeat(auto-fit,minmax(min(17rem,100%),1fr))] gap-3 max-sm:gap-0 max-sm:overflow-hidden max-sm:rounded-panel max-sm:border max-sm:border-line max-sm:bg-card">
            {plays.map((play, i) => (
              <li key={play.key} className={`flex flex-col gap-3 p-5.5 ${CARD_CLASS} max-sm:flex-row max-sm:items-center max-sm:rounded-none max-sm:border-0 max-sm:border-b max-sm:border-line max-sm:px-4 max-sm:py-3 max-sm:shadow-none max-sm:last:border-b-0`}>
                <span aria-hidden className={`flex size-11 shrink-0 items-center justify-center rounded-card ${play.tone} max-sm:size-9`}>
                  <play.icon className="size-5 max-sm:size-4" />
                </span>
                <span className="flex min-w-0 flex-col gap-3 max-sm:flex-1 max-sm:gap-0.5">
                  <h3 className="text-title text-ink max-sm:text-body">{play.title}</h3>
                  <p className="text-body text-ink-2 max-sm:hidden">{play.does}</p>
                  <p className="text-caption text-ink-2 sm:hidden">{play.short}</p>
                  <p className="text-caption text-muted max-sm:hidden">{play.note}</p>
                </span>
                <AdminLink
                  href={play.href}
                  className={`mt-auto inline-flex h-10 shrink-0 items-center self-start rounded-pill px-4.5 text-body max-sm:mt-0 max-sm:self-center ${i === 0 ? "bg-brand font-medium text-brand-ink max-sm:px-3.5" : "border border-edge bg-card text-ink hover:bg-sunken max-sm:border-0 max-sm:px-1 max-sm:underline max-sm:underline-offset-2"}`}
                >
                  {play.button}
                </AdminLink>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Nothing running says so in the lead; on a phone the empty card is left out (round 38, D728). */}
      <section aria-labelledby="running" className={`flex flex-col gap-3 ${running.length + testing.length === 0 ? "max-sm:hidden" : ""}`}>
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

      {/* On a phone the list and a broadcast are two rows of one card (round 38, D728). */}
      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(20rem,100%),1fr))] gap-3 max-sm:gap-0 max-sm:overflow-hidden max-sm:rounded-panel max-sm:border max-sm:border-line max-sm:bg-card">
        <section aria-labelledby="list" className={`flex flex-col gap-2.5 px-5.5 py-5 ${CARD_CLASS} ${PHONE_ROW}`}>
          <span className="flex min-w-0 flex-col gap-2.5 max-sm:gap-0.5">
            <h2 id="list" className="text-body-strong text-ink max-sm:text-body max-sm:font-normal">
              {w.list}
            </h2>
            <p className="text-[26px] tracking-tight max-sm:hidden">
              {n(listed)} <span className="text-body tracking-normal text-muted">{listed === 1 ? w.listCount.one : w.listCount.many}</span>
            </p>
            <p className="text-caption text-ink-2 sm:hidden">
              {n(listed)} {listed === 1 ? w.listCount.one : w.listCount.many}
            </p>
            <p className="text-body text-ink-2 max-sm:hidden">{w.listText}</p>
          </span>
          <AdminLink href={`${base}/subscribers`} className={`self-start text-body font-medium text-brand-text underline-offset-2 hover:underline ${PHONE_LINK}`}>
            <span className="max-sm:hidden">{w.listLink}</span>
            <span className="sm:hidden">{w.phone.listSee}</span>
          </AdminLink>
        </section>
        <section aria-labelledby="tell" className={`flex flex-col gap-2.5 px-5.5 py-5 ${CARD_CLASS} ${PHONE_ROW}`}>
          <span className="flex min-w-0 flex-col gap-2.5 max-sm:gap-0.5">
            <h2 id="tell" className="text-body-strong text-ink max-sm:text-body max-sm:font-normal">
              {w.tell}
            </h2>
            <p className="text-body text-ink-2 max-sm:hidden">{w.tellText}</p>
            <p className="text-caption text-ink-2 sm:hidden">{w.phone.tellSub}</p>
          </span>
          <AdminLink href={`${base}/broadcasts/new`} className={`self-start text-body font-medium text-brand-text underline-offset-2 hover:underline ${PHONE_LINK}`}>
            <span className="max-sm:hidden">{w.tellLink}</span>
            <span className="sm:hidden">{w.phone.tellWrite}</span>
          </AdminLink>
        </section>
      </div>

      {/* One contact policy across email and texts (D764): the sentence, and its settings under Change. */}
      <ContactPolicyCard
        policy={policy}
        words={MARKETING_WORDS[lang].contactPolicy}
        action={memberCan(member, "marketing:write") ? contactPolicyAction.bind(null, store.slug) : null}
      />

      <section aria-labelledby="tools" className={`flex flex-col gap-3 px-5.5 py-4.5 ${CARD_CLASS}`}>
        <h2 id="tools" className="text-body-strong text-ink">
          {w.tools} <span className="text-caption font-normal text-muted">{w.toolsSub}</span>
        </h2>
        <PhoneMore hidden={Math.max(0, tools.length - TOOLS_FIRST)} label={fillWords(w.phone.more, { n: tools.length - TOOLS_FIRST })} className="flex flex-wrap items-center gap-2">
        <ul className="contents">
          {tools.map((item, i) => (
            <li key={item.path} className={i >= TOOLS_FIRST ? PHONE_MORE_HIDDEN : ""}>
              <AdminLink href={`${base}${item.path}`} className="inline-flex h-9 items-center gap-2 rounded-pill bg-sunken px-3.5 text-body text-ink hover:bg-line">
                <NavIcon name={item.icon} className="size-3.5 text-ink-2" />
                {say(item.label)}
              </AdminLink>
            </li>
          ))}
        </ul>
        </PhoneMore>
      </section>
    </div>
  );
}

/** A card that is one row of a shared card on a phone (round 38, D728). */
const PHONE_ROW = "max-sm:min-h-14 max-sm:flex-row max-sm:items-center max-sm:justify-between max-sm:gap-3 max-sm:rounded-none max-sm:border-0 max-sm:border-b max-sm:border-line max-sm:px-4 max-sm:py-2.5 max-sm:shadow-none max-sm:last:border-b-0";
/** Its link on a phone: a short word at the right. */
const PHONE_LINK = "max-sm:shrink-0 max-sm:self-center max-sm:text-ink max-sm:underline";
