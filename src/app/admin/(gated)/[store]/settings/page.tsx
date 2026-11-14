import type { Metadata } from "next";
import { connection } from "next/server";

import { SettingsHub, type SettingCard, type SettingState } from "@/components/admin/settings-hub";
import { countWords, fillWords } from "@/lib/admin-fill";
import { adminLangOf } from "@/lib/admin-lang";
import { navWord } from "@/lib/admin-nav-words";
import { adminText } from "@/lib/admin-text";
import { canOpenPath } from "@/lib/permissions";
import { featureOn } from "@/lib/store-features";
import { STORE_SECTIONS, storeSections } from "@/lib/store-nav";
import { holderOf } from "@/server/auth";
import { teamSize } from "@/server/home";
import { memberCan, requirePermission } from "@/server/permissions";
import { getSetupProgress } from "@/server/setup";

export const metadata: Metadata = { title: "Settings" };

/** Where each everyday setting sits by job (round 2, D597); a setting in none of these is under *Everything else*. */
const JOBS: { key: "paid" | "deliver" | "business" | "look"; paths: string[] }[] = [
  { key: "paid", paths: ["/settings/payments", "/billing", "/settings/tax"] },
  { key: "deliver", paths: ["/settings/shipping", "/settings/countries", "/settings/features"] },
  { key: "business", paths: ["/settings/company", "/settings/domains", "/staff"] },
  { key: "look", paths: ["/settings/navigation", "/settings/legal"] },
];

/**
 * The store's settings (D147; round 2, D597): by job, each card with its state where the store's own setup says one (business details,
 * countries, checkout, delivery prices, the plan, the team), the essentials as a strip with the next fix as the one green button, and every
 * other setting the member may open listed by name.
 */
export default async function StoreSettingsPage({ params }: PageProps<"/admin/[store]/settings">) {
  // Per request: admin pages never read the database while the site is built.
  await connection();
  const member = await requirePermission((await params).store, "settings:read");
  const { store } = member;
  const lang = adminLangOf(member.account.adminLocale);
  const t = adminText(lang, "home").settings;
  // The cards of a member's own role only (wave 1, 1f): a card for a page they cannot open would be a link to a 404.
  const holder = holderOf(member);
  const section = storeSections(store, (path) => canOpenPath(holder, path)).find((s) => s.key === "settings") ?? STORE_SECTIONS.find((s) => s.key === "settings")!;
  const [progress, team] = await Promise.all([getSetupProgress(store), teamSize(store.id)]);
  const selling = featureOn(store, "shop");
  const base = `/admin/${store.slug}`;
  const items = section.groups.flatMap((g) => g.items);

  const state = (path: string): SettingState | undefined => {
    const s = t.state;
    switch (path) {
      case "/settings/company":
        return progress.details ? { tone: "positive", text: s.detailsSet } : { tone: "warning", text: s.detailsMissing };
      case "/settings/countries":
        return progress.countries ? { tone: "positive", text: store.markets.map((m) => m.name).join(", ") } : { tone: "warning", text: s.noCountries };
      case "/settings/payments":
        return !progress.paymentsOn ? { tone: "warning", text: s.paymentsOff } : store.paymentsTest ? { tone: "neutral", text: s.paymentsTest } : { tone: "positive", text: s.paymentsLive };
      case "/settings/shipping":
        return progress.shipping ? { tone: "positive", text: s.shippingSet } : { tone: "warning", text: s.shippingMissing };
      case "/billing":
        return store.house ? undefined : progress.plan ? { tone: "positive", text: s.onPlan } : { tone: "warning", text: s.noPlan };
      case "/staff":
        return team > 0 ? { tone: "neutral", text: countWords(team, s.team) } : undefined;
      case "/settings/features":
        return { tone: "neutral", text: countWords(store.features.length, s.features) };
      default:
        return undefined;
    }
  };
  const label = (path: string, fallback: string) => (path === "/billing" ? t.labels.billing : path === "/settings/tax" ? t.labels.tax : navWord(lang, fallback));
  const card = (item: (typeof items)[number]): SettingCard => ({
    href: `${base}${item.path}`,
    label: label(item.path, item.label),
    icon: item.icon,
    state: state(item.path),
    hint: navWord(lang, item.description),
    words: `${item.label} ${item.description}`,
  });
  const placed = new Set(JOBS.flatMap((j) => j.paths));
  const groups = JOBS.map((job) => ({
    heading: t.groups[job.key],
    items: job.paths.flatMap((path) => items.filter((item) => item.path === path)).map(card),
  })).filter((g) => g.items.length > 0);
  const rest = items.filter((item) => !placed.has(item.path)).map(card);

  // The essentials: what a store needs before real payments, the next one to fix first.
  const essentials = [
    { done: progress.details, fix: { href: `${base}/settings/company`, label: t.fix.details } },
    { done: progress.countries, fix: { href: `${base}/settings/countries`, label: t.fix.countries } },
    ...(selling
      ? [
          { done: progress.paymentsOn, fix: { href: `${base}/settings/payments`, label: t.fix.payments } },
          { done: progress.shipping, fix: { href: `${base}/settings/shipping`, label: t.fix.shipping } },
        ]
      : []),
    ...(store.house ? [] : [{ done: progress.plan, fix: { href: `${base}/billing`, label: t.fix.plan } }]),
  ];
  const left = essentials.filter((e) => !e.done);
  const owner = memberCan(member, "owner");
  const lead = left.length === 0 ? t.allSet : countWords(left.length, t.needs, { list: left.map((e) => e.fix.label.toLocaleLowerCase()).join(", ") });
  return (
    <SettingsHub
      title={navWord(lang, section.label)}
      lead={lead}
      progress={{
        done: essentials.length - left.length,
        total: essentials.length,
        label: fillWords(t.progress, { done: essentials.length - left.length, total: essentials.length }),
        next: owner && left[0] ? left[0].fix : null,
      }}
      groups={groups}
      rest={rest}
      words={{ find: t.find, findPlaceholder: t.findPlaceholder, progressSub: t.progressSub, everythingElse: t.everythingElse, everythingElseSub: countWords(rest.length, t.everythingElseSub) }}
    />
  );
}
