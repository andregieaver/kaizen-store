import type { Metadata } from "next";
import Link from "next/link";

import { SelectNav } from "@/components/admin/select-nav";
import { Search } from "lucide-react";

import { IntegrationMark } from "@/components/admin/integration-mark";
import { adminLangOf } from "@/lib/admin-lang";
import { countWords, fillWords } from "@/lib/admin-fill";
import { INTEGRATIONS } from "@/lib/integrations";
import { canCheck, CARRIERS } from "@/lib/shipping-carriers";
import { CARRIERS_WORDS } from "@/lib/admin-words/carriers";
import { FIKEN_WORDS } from "@/lib/admin-words/fiken";
import { NOTIFICATIONS_WORDS } from "@/lib/admin-words/notifications";
import { requirePermission } from "@/server/permissions";
import { listIntegrations } from "@/server/integrations";
import { listEndpoints } from "@/server/webhook-endpoints";
import { listCarriers } from "@/server/shipping-carriers";
import { getEbayConnection } from "@/server/ebay";
import { fikenCounts, getFikenConnection } from "@/server/fiken";
import { getGoogleSettings } from "@/server/google-reviews";
import { instagramStatus } from "@/server/instagram";
import { getTripletexConnection, tripletexCounts } from "@/server/tripletex";
import { CARD_CLASS, PageHeader } from "@/components/admin/ui";

export const metadata: Metadata = { title: "Integrations" };

type Group = "delivery" | "accounting" | "sell" | "pages" | "automate";
const GROUPS: readonly Group[] = ["delivery", "accounting", "sell", "pages", "automate"];
type Badge = { text: string; tone: string; problem?: boolean };
/** One service as a row: what it does, how it stands, and the one action. */
type Entry = { id: string; name: string; summary: string; group: Group; href: string; action: string; badge: Badge | null; connected: boolean; local: boolean };

const ON = "bg-positive-soft text-positive-text";
const LOOK = "bg-warning-soft text-warning-text";
const QUIET = "bg-sunken text-muted";

/**
 * Every integration a store can turn on (D41), drawn for Homer in round 6 (D620): a sentence on what is connected, the connected ones
 * first, a good start for a shop that has none, then every service as a short row under what it does for the owner, with a search and
 * chips to narrow it (both plain links and a GET form, so they work without script). Carriers that do not deliver in the store's
 * countries are folded under one line.
 */
export default async function IntegrationsPage({ params, searchParams }: PageProps<"/admin/[store]/integrations">) {
  const member = await requirePermission((await params).store, "settings:read");
  const { store } = member;
  const query = await searchParams;
  const q = (typeof query.q === "string" ? query.q : "").trim().slice(0, 60);
  const show = typeof query.show === "string" && (GROUPS as readonly string[]).includes(query.show) ? (query.show as Group) : null;
  const lang = adminLangOf(member.account.adminLocale);
  const all = NOTIFICATIONS_WORDS[lang];
  const carrierWords = CARRIERS_WORDS[lang] as Record<string, { summary: string } | undefined>;
  const w = all.integrations;
  const h = w.hub;
  const k = w.carrier;
  const [connected, carriers, endpoints, tripletex, tripletexSent, fiken, fikenSent, ebay, google, instagram] = await Promise.all([
    listIntegrations(store.id),
    listCarriers(store.id),
    listEndpoints(store.id),
    getTripletexConnection(store.id),
    tripletexCounts(store.id),
    getFikenConnection(store.id),
    fikenCounts(store.id),
    getEbayConnection(store.id),
    getGoogleSettings(store.id),
    instagramStatus(store.id),
  ]);
  // Tripletex and Fiken are not webhooks (D453, D460): their state is their own connection's.
  const tx = w.tripletex.listStatus;
  const tripletexBadge: Badge | null = !tripletex
    ? null
    : tripletex.state === "auth_failed"
      ? { text: tx.auth_failed, tone: LOOK, problem: true }
      : tripletex.state === "on" && (tripletexSent?.blocked ?? 0) + (tripletexSent?.failed ?? 0) > 0
        ? { text: tx.problems, tone: LOOK, problem: true }
        : tripletex.state === "on"
          ? { text: tx.on, tone: ON }
          : { text: tx[tripletex.state], tone: QUIET };
  const fk = FIKEN_WORDS[lang].listStatus;
  const fikenBadge: Badge | null = !fiken
    ? null
    : fiken.state === "auth_failed"
      ? { text: fk.auth_failed, tone: LOOK, problem: true }
      : fiken.state === "on" && (fikenSent?.blocked ?? 0) + (fikenSent?.failed ?? 0) > 0
        ? { text: fk.problems, tone: LOOK, problem: true }
        : fiken.state === "on"
          ? { text: fk.on, tone: ON }
          : { text: fk[fiken.state], tone: QUIET };
  const base = `/admin/${store.slug}/integrations`;
  const markets = new Set(store.markets.map((m) => m.code));

  const services: Entry[] = INTEGRATIONS.map((info) => {
    const status =
      info.id === "tripletex"
        ? tripletex
          ? { enabled: tripletex.state === "on" }
          : undefined
        : info.id === "fiken"
          ? fiken
            ? { enabled: fiken.state === "on" }
            : undefined
          : info.id === "ebay"
            ? ebay && ebay.state !== "off"
              ? { enabled: ebay.state === "connected" }
              : undefined
            : connected.find((c) => c.provider === info.id);
    const badge: Badge | null =
      info.id === "tripletex"
        ? tripletexBadge
        : info.id === "fiken"
          ? fikenBadge
          : info.comingSoon
            ? { text: w.comingSoon, tone: QUIET }
            : !status
              ? null
              : status.enabled
                ? "recentFailures" in status && status.recentFailures > 0
                  ? { text: w.someFailed, tone: LOOK, problem: true }
                  : { text: all.common.on, tone: ON }
                : { text: all.common.off, tone: QUIET };
    const group: Group = info.id === "tripletex" || info.id === "fiken" ? "accounting" : info.id === "ebay" ? "sell" : "automate";
    return {
      id: info.id,
      name: info.name,
      summary: w.infos[info.id]?.summary ?? info.summary,
      group,
      href: info.comingSoon ? "" : `${base}/${info.id}`,
      action: status ? w.manage : w.setUp,
      badge,
      connected: Boolean(status),
      local: true,
    };
  });
  const carrierEntries: Entry[] = CARRIERS.map((info) => {
    const saved = carriers.find((c) => c.carrier === info.id);
    const badge: Badge | null = !saved
      ? info.available.length > 0
        ? null
        : { text: k.preparing, tone: QUIET }
      : saved.complete
        ? canCheck(info)
          ? saved.check?.ok
            ? { text: k.connected, tone: ON }
            : { text: saved.check ? k.notAccepted : k.check, tone: LOOK, problem: true }
          : { text: k.saved, tone: ON }
        : { text: k.needs, tone: LOOK, problem: true };
    return {
      id: info.id,
      name: info.name,
      summary: carrierWords[info.id]?.summary ?? info.summary,
      group: "delivery",
      href: `${base}/shipping/${info.id}`,
      action: saved ? w.manage : info.available.length > 0 ? k.connect : k.getReady,
      badge,
      connected: Boolean(saved),
      local: info.countries.some((c) => markets.has(c)),
    };
  });
  const pages: Entry[] = [
    {
      id: "instagram",
      name: w.instagramTitle,
      summary: w.instagramDescription,
      group: "pages",
      href: `${base}/instagram`,
      action: instagram ? w.manage : w.instagramSetUp,
      badge: instagram ? (instagram.problem ? { text: w.someFailed, tone: LOOK, problem: true } : { text: all.common.on, tone: ON }) : null,
      connected: Boolean(instagram),
      local: true,
    },
    {
      id: "google",
      name: w.googleTitle,
      summary: w.googleDescription,
      group: "pages",
      href: `${base}/google-reviews`,
      action: google ? w.manage : w.googleSetUp,
      badge: google?.place ? { text: all.common.on, tone: ON } : null,
      connected: Boolean(google?.place),
      local: true,
    },
  ];
  const endpointEntry: Entry = {
    id: "endpoints",
    name: h.endpointsName,
    summary: w.endpoints.cardDescription,
    group: "automate",
    href: `${base}/endpoints`,
    action: endpoints.length > 0 ? w.manage : w.endpoints.cardButton,
    badge: endpoints.length > 0 ? { text: countWords(endpoints.length, w.endpoints.cardCount), tone: ON } : null,
    connected: endpoints.length > 0,
    local: true,
  };
  const every = [...carrierEntries, ...services.filter((s) => s.group === "accounting"), ...services.filter((s) => s.group === "sell"), ...pages, ...services.filter((s) => s.group === "automate"), endpointEntry];
  const on = every.filter((e) => e.connected);
  const problems = on.filter((e) => e.badge?.problem).length;

  // A good start (round 6): a carrier for the store's countries, its accounting where it sells in Norway, and Google reviews, each only
  // while nothing of its kind is connected.
  const firstCarrier = carrierEntries.find((c) => c.local && !c.badge && c.action === k.connect);
  const starts = [
    !carrierEntries.some((c) => c.connected) && firstCarrier
      ? { id: firstCarrier.id, name: firstCarrier.name, text: h.carrierText, href: firstCarrier.href, action: fillWords(h.connectNamed, { name: firstCarrier.name }) }
      : null,
    markets.has("NO") && !tripletex && !fiken ? { id: "fiken", name: h.accountingName, text: h.accountingText, href: `${base}/fiken`, action: h.chooseAccounting } : null,
    !google?.place ? { id: "google", name: w.googleTitle, text: h.reviewsText, href: `${base}/google-reviews`, action: h.showReviews } : null,
  ].filter((x) => x !== null);

  const needle = q.toLocaleLowerCase();
  const listed = every.filter((e) => (!show || e.group === show) && (!needle || `${e.name} ${e.summary}`.toLocaleLowerCase().includes(needle)));
  const href = (group: Group | null) => {
    const params = new URLSearchParams();
    if (group) params.set("show", group);
    if (q) params.set("q", q);
    const text = params.toString();
    return text ? `${base}?${text}` : base;
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <PageHeader
          title={w.title}
          meta={[
            <span key="state">
              <span className="text-ink">{on.length === 0 ? h.none : countWords(on.length, h.some)}</span>
              {on.length > 0 && (problems > 0 ? countWords(problems, h.problems) : h.end)}
              {on.length === 0 && h.startHint}
            </span>,
          ]}
        />
        {/* Round 33 (D707): on a phone the kinds are one choice beside the search; the chips from the small breakpoint up. */}
        <div className="grid w-full grid-cols-[minmax(0,1fr)_8.5rem] gap-2 sm:flex sm:w-auto">
        <form method="get" role="search" className="flex h-11 w-full items-center gap-2 rounded-pill border border-edge bg-card px-3.5 sm:w-72">
          {show && <input type="hidden" name="show" value={show} />}
          <Search aria-hidden className="size-4 shrink-0 text-muted" />
          <input name="q" type="search" defaultValue={q} aria-label={h.find} placeholder={h.find} className="min-w-0 flex-1 bg-transparent text-body text-ink outline-none" />
          <button type="submit" className="sr-only">{h.search}</button>
        </form>
        <SelectNav
          hideLabel
          label={h.show}
          className="sm:hidden"
          options={([null, ...GROUPS] as const).map((group) => ({
            label: `${h.groups[group ?? "all"]} ${every.filter((e) => !group || e.group === group).length}`,
            href: href(group),
            current: group === show,
          }))}
        />
        </div>
      </div>

      {on.length > 0 && !q && !show && (
        <section aria-labelledby="connected" className={`flex flex-col gap-2 px-6 py-5 ${CARD_CLASS}`}>
          <h2 id="connected" className="text-title text-ink">{h.connectedTitle}</h2>
          <ul className="grid grid-cols-[repeat(auto-fit,minmax(min(340px,100%),1fr))] gap-x-8">
            {on.map((e) => (
              <ServiceRow key={`on-${e.id}`} entry={e} />
            ))}
          </ul>
        </section>
      )}

      {starts.length > 0 && !q && !show && (
        <section aria-labelledby="start" className="flex flex-col gap-3">
          <h2 id="start" className="text-title text-ink">{h.startTitle}</h2>
          <ul className="grid grid-cols-[repeat(auto-fit,minmax(min(260px,100%),1fr))] gap-3">
            {starts.map((s, i) => (
              <li key={s.id} className={`flex flex-col gap-2 p-4.5 ${CARD_CLASS} ${i > 0 ? "max-sm:hidden" : ""}`}>
                <span className="flex items-center gap-2.5">
                  <IntegrationMark id={s.id} />
                  <span className="text-body text-ink">{s.name}</span>
                </span>
                <span className="text-caption text-ink-2">{s.text}</span>
                <Link
                  href={s.href}
                  className={
                    i === 0
                      ? "mt-auto inline-flex h-10 items-center self-start rounded-pill bg-brand px-4 text-sm font-medium text-brand-ink hover:bg-brand-hover"
                      : "mt-auto self-start pt-1 text-body text-brand-text hover:underline"
                  }
                >
                  {s.action}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section aria-labelledby="every" className={`flex flex-col gap-4 px-6 py-5 ${CARD_CLASS}`}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id="every" className="text-title text-ink">{h.allTitle}</h2>
          <nav aria-label={h.show} className="flex flex-wrap gap-1.5 max-sm:hidden">
            {([null, ...GROUPS] as const).map((group) => {
              const count = every.filter((e) => !group || e.group === group).length;
              const current = group === show;
              return (
                <Link
                  key={group ?? "all"}
                  href={href(group)}
                  aria-current={current ? "page" : undefined}
                  className={`inline-flex h-9 items-center gap-1.5 rounded-pill px-3 text-caption ${current ? "bg-inverse text-inverse-ink" : "border border-edge bg-card text-ink hover:bg-sunken"}`}
                >
                  {h.groups[group ?? "all"]} <span className={current ? "" : "text-muted"}>{count}</span>
                </Link>
              );
            })}
          </nav>
        </div>
        {listed.length === 0 ? (
          <p className="text-body text-ink-2">
            {fillWords(h.nothingMatches, { q })}{" "}
            <Link href={base} className="text-brand-text hover:underline">
              {h.clear}
            </Link>
          </p>
        ) : (
          <div className="grid grid-cols-[repeat(auto-fit,minmax(min(340px,100%),1fr))] gap-x-8 gap-y-4">
            {GROUPS.filter((group) => listed.some((e) => e.group === group)).map((group) => {
              const rows = listed.filter((e) => e.group === group);
              // Carriers for other countries are folded unless searched for or connected (round 6).
              const near = group === "delivery" && !needle ? rows.filter((e) => e.local || e.connected) : rows;
              const far = group === "delivery" && !needle ? rows.filter((e) => !e.local && !e.connected) : [];
              return (
                <div key={group} className="flex flex-col">
                  <h3 className="py-1.5 text-eyebrow text-muted uppercase">{group === "delivery" ? h.inYourCountries : h.groups[group]}</h3>
                  <ul className="flex flex-col">
                    {near.map((e) => (
                      <ServiceRow key={e.id} entry={e} />
                    ))}
                  </ul>
                  {far.length > 0 && (
                    <details>
                      <summary className="flex min-h-11 cursor-pointer items-center text-caption text-ink-2">{countWords(far.length, h.otherCarriers)}</summary>
                      <ul className="flex flex-col">
                        {far.map((e) => (
                          <ServiceRow key={e.id} entry={e} />
                        ))}
                      </ul>
                    </details>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}

/** A service as a short row: its mark, name and state, what it does in a line, and its one action as a link. */
function ServiceRow({ entry: e }: { entry: Entry }) {
  return (
    // Round 33 (D707): on a phone one line, the mark, the name and the action; what it does is on the service's own page.
    <li className="flex min-h-16 items-center gap-3 border-b border-line py-2 max-sm:min-h-12">
      <span className="[&>span]:size-8 [&>span]:rounded-md [&>span]:text-sm">
        <IntegrationMark id={e.id} />
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <h3 className="flex flex-wrap items-center gap-2 text-body text-ink">
          {e.name}
          {e.badge && <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${e.badge.tone}`}>{e.badge.text}</span>}
        </h3>
        <span className="line-clamp-2 text-caption text-muted max-sm:hidden">{e.summary}</span>
      </span>
      {e.href ? (
        <Link href={e.href} className="shrink-0 text-body text-brand-text hover:underline">
          {e.action} <span className="sr-only">&nbsp;{e.name}</span>
        </Link>
      ) : null}
    </li>
  );
}
