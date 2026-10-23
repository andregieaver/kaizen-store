import type { Metadata } from "next";
import { connection } from "next/server";
import { Suspense } from "react";

import { ActionForm, SubmitButton } from "@/components/admin/action-form";
import { DnsZoneCard } from "@/components/admin/dns-zone-card";
import { DomainRegistrationsCard } from "@/components/admin/domain-registrations-card";
import { ButtonLink, Card, List, ListRow, PageHeader, RowActions, RowLead } from "@/components/admin/ui";
import { ADMIN_LANG_FACTS, adminLangOf, type AdminLang } from "@/lib/admin-lang";
import { fillWords } from "@/lib/admin-fill";
import { adminText } from "@/lib/admin-text";
import { isProtected } from "@/lib/dns-plan";
import { requireAccount, type Account } from "@/server/auth";
import { heldDomains, linkableStores } from "@/server/domain-account";
import { dnsAuto, dnsHistory, storeZones, zoneRecords } from "@/server/domain-dns";
import { accountHolder } from "@/server/domain-holder";
import { registrationHolder, renewalOffer, storeDomainPurchases } from "@/server/domain-purchases";
import { storeRegistrations } from "@/server/domain-registrations";

import {
  accountApplyDnsAction,
  accountCheckDnsAction,
  accountDnsAutoAction,
  accountRenewAction,
  accountRenewalAction,
  accountUndoDnsAction,
  linkDomainAction,
  unlinkDomainAction,
} from "./actions";

export const metadata: Metadata = { title: "Your domains" };

/**
 * *Your domains* (D317, `docs/domains-standalone.md` 2): every domain the account holds, which store uses it, and moving it between the
 * person's stores. Renewal, DNS and moving away sit one step down, as on a store's Domains page; the account is the holder, so nothing here
 * asks a store's permissions.
 */
export default async function YourDomainsPage() {
  await connection();
  const account = await requireAccount();
  const lang = adminLangOf(account.adminLocale);
  const words = adminText(lang, "domains");
  const [held, stores] = await Promise.all([heldDomains(account.id), linkableStores(account.id)]);
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={words.account.title} description={words.account.intro} />
      <Card title={words.account.title}>
        {held.length === 0 ? (
          <p className="text-body text-muted">{words.account.none}</p>
        ) : (
          <List label={words.account.title}>
            {held.map((d) => {
              const others = stores.filter((s) => s.id !== d.store?.id);
              return (
                <ListRow key={d.apex}>
                  <RowLead
                    title={d.apex}
                    sub={[
                      d.store ? fillWords(words.account.usedBy, { store: d.store.name }) : words.account.noStore,
                      d.registrationId ? words.account.registeredHere : null,
                      d.zoneId ? words.account.dnsHere : null,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  />
                  <RowActions>
                    {d.store && (
                      <ButtonLink kind="quiet" href={`/admin/${d.store.slug}/settings/domains`}>
                        {words.account.openStore}
                      </ButtonLink>
                    )}
                    <ButtonLink kind="quiet" href={`/admin/account/domains/move/${encodeURIComponent(d.apex)}`}>
                      {fillWords(words.account.moveAway, { domain: d.apex })}
                    </ButtonLink>
                  </RowActions>
                  {others.length > 0 && (
                    <ActionForm action={linkDomainAction} className="flex w-full flex-wrap items-end gap-2">
                      <input type="hidden" name="domain" value={d.apex} />
                      <label className="flex flex-col gap-1 text-caption text-muted">
                        {words.account.store}
                        <select name="store" className="min-h-10 rounded-lg border border-edge bg-card px-3 text-body text-ink" defaultValue={others[0].id}>
                          {others.map((s) => (
                            <option key={s.id} value={s.id}>
                              {s.name}
                            </option>
                          ))}
                        </select>
                      </label>
                      <SubmitButton variant="secondary">{d.store ? words.account.moveTo : words.account.useWith}</SubmitButton>
                    </ActionForm>
                  )}
                  {d.store && d.billable && (
                    <ActionForm action={unlinkDomainAction}>
                      <input type="hidden" name="domain" value={d.apex} />
                      <SubmitButton variant="secondary">{fillWords(words.account.stopUsing, { store: d.store.name })}</SubmitButton>
                    </ActionForm>
                  )}
                </ListRow>
              );
            })}
          </List>
        )}
      </Card>
      <Suspense fallback={<div className="h-24 animate-pulse rounded-card bg-sunken" />}>
        <Registrations account={account} lang={lang} />
      </Suspense>
      <Suspense fallback={<div className="h-24 animate-pulse rounded-card bg-sunken" />}>
        <KeptDns account={account} lang={lang} />
      </Suspense>
    </div>
  );
}

/** What the account registered here, with renewal: billed to the store a domain is used by, or to the account (D317 decision 6). */
async function Registrations({ account, lang }: { account: Account; lang: AdminLang }) {
  const holder = accountHolder(account.id);
  const words = adminText(lang, "domains");
  const [registrations, purchases] = await Promise.all([storeRegistrations(holder), storeDomainPurchases(holder)]);
  const renewals = await Promise.all(
    registrations.map((r) =>
      r.status !== "transferring_out" ? renewalOffer(registrationHolder({ store_id: r.storeId, account_id: r.accountId }), r.apex, r.registrar, 1).catch(() => null) : Promise.resolve(null),
    ),
  );
  return (
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
      owner
      words={words}
      locale={ADMIN_LANG_FACTS[lang].locale}
      actions={{ renewal: accountRenewalAction, renew: accountRenewAction }}
    />
  );
}

/** The DNS Kaizena Flow keeps for the account's domains (D315 phase 3), as on a store's page. */
async function KeptDns({ account, lang }: { account: Account; lang: AdminLang }) {
  const holder = accountHolder(account.id);
  const zones = await storeZones(holder);
  if (zones.length === 0) return null;
  const words = adminText(lang, "domains").dns;
  const auto = await dnsAuto(holder);
  const cards = await Promise.all(
    zones.map(async (zone) => {
      const [read, history] = await Promise.all([zoneRecords(holder, zone.apex), dnsHistory(holder, zone.apex, 20)]);
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
              by: h.source === "ai_manager" || (h.source === "recipe" && h.automatic) ? words.byAi : (h.actor ?? "Kaizena Flow"),
              when: h.createdAt,
              automatic: h.automatic,
              undone: h.undoneAt !== null,
              isUndo: h.source === "undo",
            }))}
            words={words}
            owner
            auto={auto}
            locale={ADMIN_LANG_FACTS[lang].locale}
            actions={{ check: accountCheckDnsAction, apply: accountApplyDnsAction, undo: accountUndoDnsAction, auto: accountDnsAutoAction }}
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
