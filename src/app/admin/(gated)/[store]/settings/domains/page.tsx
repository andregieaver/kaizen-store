import type { Metadata } from "next";
import { Suspense } from "react";

import { DomainBuyer } from "@/components/admin/domain-buyer";
import { DomainHealthCard } from "@/components/admin/domain-health-card";
import { DomainRegistrationsCard } from "@/components/admin/domain-registrations-card";
import { DnsZoneCard } from "@/components/admin/dns-zone-card";
import { isProtected } from "@/lib/dns-plan";
import { dnsAuto, dnsHistory, storeZones, zoneRecords } from "@/server/domain-dns";
import { DomainsPanel } from "@/components/admin/domains-panel";
import { hostOrigin, storeBase, storeDomain, storeHref } from "@/lib/paths";
import { checkPermission, memberCan, requireOwnerRole } from "@/server/permissions";
import { checkWaitingDomains, deployIfBehind, listStoreDomains, routedAsSaved, type StoreDomain } from "@/server/domains";
import { storeDomainHealth } from "@/server/domain-health";
import { buyingOpen, renewalOffer, storeDomainPurchases } from "@/server/domain-purchases";
import { suggestedRegistrant } from "@/server/domain-registrant";
import { registrationFacts, storeRegistrations } from "@/server/domain-registrations";
import type { Membership } from "@/server/auth";
import { domainsConfigured } from "@/server/vercel";
import { ButtonLink, Card, PageHeader } from "@/components/admin/ui";
import { domainConnectKey } from "@/lib/env";
import { siteUrl } from "@/lib/site";
import { domainConnectFor, signedApplyUrl } from "@/server/domain-connect";
import { fillWords } from "@/lib/admin-fill";
import { apexOf } from "@/lib/domain-health";

import { ADMIN_LANG_FACTS, adminLangOf } from "@/lib/admin-lang";
import { adminText } from "@/lib/admin-text";
import { domainCountries, domainLanguages } from "@/lib/custom-domains";

import {
  addDomainAction,
  applyDnsAction,
  buyDomainAction,
  checkDnsAction,
  dnsAutoAction,
  undoDnsAction,
  checkDomainAction,
  domainRenewalAction,
  languageDomainAction,
  countryDomainAction,
  primaryDomainAction,
  removeDomainAction,
  renewDomainAction,
  searchDomainsAction,
} from "./actions";

export const metadata: Metadata = { title: "Domains" };

/** The store's addresses and its own domains (P7, P8). */
export default async function DomainsPage({ params, searchParams }: PageProps<"/admin/[store]/settings/domains">) {
  // A closed store's owner still reaches its domains (D315 9.3): the owner's key is allowed there, settings are not.
  const slug = (await params).store;
  const current = (await checkPermission(slug, "settings:read")) ?? (await requireOwnerRole(slug));
  const { store } = current;
  const lang = adminLangOf(current.account.adminLocale);
  const domain = storeDomain();
  if (!domain) {
    return (
      <PageHeader
        title="Domains"
        description={<>Your store is at {storeHref(store.slug, storeBase(store.slug))} on Kaizena Flow&apos;s own address for now. Stores get addresses of their own, and can use their own domains, once Kaizena Flow&apos;s store domain is set up.</>}
      />
    );
  }
  // Waiting domains are checked as the owner looks; a deployment that did not happen is asked for again.
  await checkWaitingDomains(store.id);
  const domains = await listStoreDomains(store.id);
  const deploying = !routedAsSaved(store.slug, domains);
  if (deploying) await deployIfBehind(store.slug, domains).catch(() => false);
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Domains" description={<>Where shoppers find your store: its address on Kaizena Flow, or a domain of your own.</>} />
      {(await searchParams).dc === "back" && <p role="status" className="text-body text-ink-2">{adminText(lang, "domains").connectAuto.back}</p>}
      {memberCan(current, "owner") && (
        <Suspense fallback={null}>
          <ConnectAutomatically slug={store.slug} domains={domains.filter((d) => d.status === "pending")} lang={lang} />
        </Suspense>
      )}
      <Suspense fallback={<div className="h-24 animate-pulse rounded-card bg-sunken" />}>
        <DomainHealth storeId={store.id} lang={lang} />
      </Suspense>
      <Suspense fallback={<div className="h-24 animate-pulse rounded-card bg-sunken" />}>
        <KeptDns member={current} lang={lang} />
      </Suspense>
      <Suspense fallback={<div className="h-24 animate-pulse rounded-card bg-sunken" />}>
        <GetADomain member={current} lang={lang} />
      </Suspense>
      {memberCan(current, "owner") && <MoveLinks storeId={store.id} slug={store.slug} hosts={domains.map((d) => d.hostname)} lang={lang} />}
      <DomainsPanel
        address={storeHref(store.slug, storeBase(store.slug))}
        hostAddress={hostOrigin(`${store.slug}.${domain.split(":")[0]}`)}
        domains={domains}
        deploying={deploying}
        owner={memberCan(current, "owner")}
        configured={domainsConfigured()}
        languages={domainLanguages(store, ADMIN_LANG_FACTS[lang].locale)}
        countries={domainCountries(store, ADMIN_LANG_FACTS[lang].locale)}
        words={adminText(lang, "domains")}
        locale={ADMIN_LANG_FACTS[lang].locale}
        actions={{
          add: addDomainAction.bind(null, store.slug),
          check: checkDomainAction.bind(null, store.slug),
          primary: primaryDomainAction.bind(null, store.slug),
          remove: removeDomainAction.bind(null, store.slug),
          language: languageDomainAction.bind(null, store.slug),
          country: countryDomainAction.bind(null, store.slug),
        }}
      />
    </div>
  );
}

/** Each domain's health (D315 5.3), read as the owner opens the page: DNS and RDAP lookups stream in after the rest. */
async function DomainHealth({ storeId, lang }: { storeId: string; lang: ReturnType<typeof adminLangOf> }) {
  const rows = await storeDomainHealth(storeId, { registrations: registrationFacts });
  return (
    <DomainHealthCard
      rows={rows.map((r) => ({
        hostname: r.facts.hostname,
        registrar: r.facts.registration.registrar,
        withUs: r.facts.registration.withUs,
        expiresAt: r.facts.registration.expiresAt,
        dnsHost: r.facts.dnsHost,
        findings: r.findings,
      }))}
      words={adminText(lang, "domains")}
      locale={ADMIN_LANG_FACTS[lang].locale}
    />
  );
}

/** Getting a domain here (D315 phase 2), and what the store registered and is buying. */
async function GetADomain({ member, lang }: { member: Membership; lang: ReturnType<typeof adminLangOf> }) {
  const { store } = member;
  const words = adminText(lang, "domains");
  const locale = ADMIN_LANG_FACTS[lang].locale;
  const owner = memberCan(member, "owner");
  const [open, registrations, purchases] = await Promise.all([buyingOpen(store.id), storeRegistrations(store.id), storeDomainPurchases(store.id)]);
  const renewals = await Promise.all(
    registrations.map((r) => (owner && r.status !== "transferring_out" ? renewalOffer(store.id, r.apex, r.registrar, 1).catch(() => null) : Promise.resolve(null))),
  );
  return (
    <>
      <DomainRegistrationsCard
        registrations={registrations.map((r, i) => ({
          apex: r.apex,
          status: r.status,
          expiresAt: r.expiresAt,
          renew: r.renew,
          contactVerified: r.contactVerified,
          renewal: renewals[i] ? { currency: renewals[i].currency, amountMinor: renewals[i].amountMinor } : null,
        }))}
        purchases={purchases}
        owner={owner}
        words={words}
        locale={locale}
        actions={{ renewal: domainRenewalAction.bind(null, store.slug), renew: renewDomainAction.bind(null, store.slug) }}
      />
      <DomainBuyer
        search={searchDomainsAction.bind(null, store.slug)}
        buy={buyDomainAction.bind(null, store.slug)}
        words={words.get}
        locale={locale}
        initialQuery={store.name}
        canBuy={owner && open}
        closedWhy={!owner ? words.get.ownerOnly : !open ? words.get.notOpen : null}
        registrant={suggestedRegistrant(member)}
      />
    </>
  );
}

/** The DNS Kaizena Flow keeps for the store's domains (D315 phase 3): records, set-ups and history, read live. */
async function KeptDns({ member, lang }: { member: Membership; lang: ReturnType<typeof adminLangOf> }) {
  const { store } = member;
  const zones = await storeZones(store.id);
  if (zones.length === 0) return null;
  const words = adminText(lang, "domains").dns;
  const owner = memberCan(member, "owner");
  const auto = await dnsAuto(store.id);
  const cards = await Promise.all(
    zones.map(async (zone) => {
      const [read, history] = await Promise.all([zoneRecords(store.id, zone.apex), dnsHistory(store.id, zone.apex, 20)]);
      return { zone, read, history };
    }),
  );
  return (
    <>
      {cards.map(({ zone, read, history }) =>
        read.ok ? (
          <DnsZoneCard
            key={zone.id}
            apex={zone.apex}
            records={read.records.map((r) => ({
              id: r.id,
              type: r.type,
              name: r.name,
              value: r.type === "SRV" && r.srv ? `${r.srv.priority} ${r.srv.weight} ${r.srv.port} ${r.srv.target}` : r.value,
              priority: r.type === "MX" ? (r.mxPriority ?? 0) : null,
              kept: isProtected(r, read.connected),
            }))}
            history={history.map((h) => ({
              id: h.id,
              summary: h.summary,
              by: h.source === "ai_manager" || h.source === "recipe" && h.automatic ? words.byAi : (h.actor ?? "Kaizena Flow"),
              when: h.createdAt,
              automatic: h.automatic,
              undone: h.undoneAt !== null,
              isUndo: h.source === "undo",
            }))}
            words={words}
            owner={owner}
            auto={auto}
            locale={ADMIN_LANG_FACTS[lang].locale}
            actions={{
              check: checkDnsAction.bind(null, store.slug),
              apply: applyDnsAction.bind(null, store.slug),
              undo: undoDnsAction.bind(null, store.slug),
              auto: dnsAutoAction.bind(null, store.slug),
            }}
          />
        ) : (
          <p key={zone.id} className="text-body text-muted">
            {zone.apex}: {read.problems.join(" ")}
          </p>
        ),
      )}
    </>
  );
}

/** *Move this domain* for each of the store's domains (D315 8): owners only, one step from the page and never in Homer's way. */
async function MoveLinks({ storeId, slug, hosts, lang }: { storeId: string; slug: string; hosts: string[]; lang: ReturnType<typeof adminLangOf> }) {
  const [registrations, zones] = await Promise.all([storeRegistrations(storeId), storeZones(storeId)]);
  const apexes = [
    ...new Set([...registrations.filter((r) => r.status !== "transferred_out").map((r) => r.apex), ...zones.map((z) => z.apex), ...hosts.map(apexOf)]),
  ].sort();
  const words = adminText(lang, "domains").move;
  return (
    <nav className="flex flex-wrap gap-2" aria-label={words.open}>
      <ButtonLink kind="secondary" href={`/admin/${slug}/settings/domains/move-in`}>
        {adminText(lang, "domains").moveIn.open}
      </ButtonLink>
      {apexes.map((apex) => (
        <ButtonLink key={apex} kind="quiet" href={`/admin/${slug}/settings/domains/move/${encodeURIComponent(apex)}`}>
          {fillWords(words.title, { domain: apex })}
        </ButtonLink>
      ))}
    </nav>
  );
}

/**
 * *Connect automatically* (D315 6, Domain Connect) for each waiting domain whose DNS provider took Kaizena Flow's template in: a signed
 * address to the provider, who asks the owner to approve. Nothing shows where no provider supports it or the signing key isn't set.
 */
async function ConnectAutomatically({ slug, domains, lang }: { slug: string; domains: StoreDomain[]; lang: ReturnType<typeof adminLangOf> }) {
  const key = domainConnectKey();
  if (!key || domains.length === 0) return null;
  const found = await Promise.all(domains.map(async (d) => ({ d, connect: await domainConnectFor(d.hostname, { key }) })));
  const offers = found.filter((f) => f.connect !== null);
  if (offers.length === 0) return null;
  const words = adminText(lang, "domains").connectAuto;
  const back = `${siteUrl()}/admin/${slug}/settings/domains?dc=back`;
  return (
    <Card title={words.title} description={words.intro}>
      <div className="flex flex-wrap gap-2">
        {offers.map(({ d, connect }) => (
          <ButtonLink
            key={d.id}
            kind="strong"
            href={signedApplyUrl(connect!.settings, connect!.kind, { hostname: d.hostname, token: d.token, ip: d.checks.aValues?.[0], redirectUri: back, state: d.id }, key)}
          >
            {fillWords(words.button, { domain: d.hostname, provider: connect!.settings.providerDisplayName ?? connect!.settings.providerName })}
          </ButtonLink>
        ))}
      </div>
    </Card>
  );
}
