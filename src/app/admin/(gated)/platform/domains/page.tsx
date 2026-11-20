import type { Metadata } from "next";
import { connection } from "next/server";

import { ActionForm, SubmitButton } from "@/components/admin/action-form";
import { PhoneRow, PhoneRows } from "@/components/admin/phone-row";
import { Card, Chip, PageHeader } from "@/components/admin/ui";
import { adminDate, PLATFORM_TIME_ZONE } from "@/lib/admin-date";
import { countWords, fillWords } from "@/lib/admin-fill";
import { ADMIN_LANG_FACTS, adminLangOf } from "@/lib/admin-lang";
import { domainPrice } from "@/lib/domain-prices";
import { formatMoney } from "@/lib/money";
import { DOMAINS_WORDS } from "@/lib/admin-words/domains";
import { requirePlatformReader } from "@/server/auth";
import { allRegistrations, domainLeads, domainsOpenToAll, domainsPublic, purchasesInReview, purchasesNeedingALook, storesBuyingDomains } from "@/server/domain-admin";
import { domainPricingRows, latestEurRates } from "@/server/domain-prices";

import { domainsOpenAction, domainsPublicAction, reviewDomainAction, saveDomainPricingAction, storeDomainBuyingAction } from "./actions";

export const metadata: Metadata = { title: "Domains" };

const input = "min-h-10 w-full rounded-md border border-line bg-card px-3 text-sm";

/**
 * Domains stores buy through Kaizena Flow (D315): the pricing rules per currency (never a price in code), which stores may buy before buying
 * opens to all (decision 9), every registration and the purchases that need a look.
 */
export default async function PlatformDomainsPage() {
  await connection();
  const account = await requirePlatformReader();
  const lang = adminLangOf(account.adminLocale);
  const locale = ADMIN_LANG_FACTS[lang].locale;
  const w = DOMAINS_WORDS[lang].platform;
  const [pricing, { rates, day }, openToAll, stores, registrations, purchases, sellsPublic, inReview, leads] = await Promise.all([
    domainPricingRows(),
    latestEurRates(),
    domainsOpenToAll(),
    storesBuyingDomains(),
    allRegistrations(),
    purchasesNeedingALook(),
    domainsPublic(),
    purchasesInReview(),
    domainLeads(),
  ]);
  const date = (iso: string) => adminDate(PLATFORM_TIME_ZONE, iso, "day", lang);
  const ph = w.phone;
  const percent = (bps: number) => new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(bps / 100);
  const lowest = (minor: number, currency: string) => formatMoney(minor, currency, locale);
  const row = { change: ph.open, done: ph.close } as const;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={w.title}
        description={
          <>
            <span className="sm:hidden">{ph.lead}</span>
            <span className="max-sm:hidden">{w.intro.replace("{date}", day ? date(day) : w.noRate)}</span>
          </>
        }
      />

      {/* Round 67 (D837): on a phone each currency is a row saying its margin and lowest price, opening its form; from sm up the forms as before. */}
      <Card title={w.pricing} className="max-sm:p-0 max-sm:[&>header]:mb-0 max-sm:[&>header]:px-4 max-sm:[&>header]:pt-4">
        <div className="flex flex-col gap-4 max-sm:gap-0 max-sm:px-4">
          {pricing.map((p, i) => {
            const example = domainPrice("11.25", "USD", 1, p, rates);
            return (
              <PhoneRow
                key={p.currency}
                inset
                last={i === pricing.length - 1}
                title={p.currency}
                sub={fillWords(ph.currencySub, { margin: percent(p.marginBps), lowest: lowest(p.minimumMinor, p.currency) })}
                change={ph.change}
                done={ph.close}
              >
              <ActionForm key={p.currency} action={saveDomainPricingAction} className="grid items-end gap-3 sm:grid-cols-[6rem_1fr_1fr_1fr_auto]">
                <input type="hidden" name="currency" value={p.currency} />
                <span className="text-body-strong text-ink">{p.currency}</span>
                <label className="flex flex-col gap-1 text-sm">
                  {w.margin}
                  <input name="margin" defaultValue={String(p.marginBps / 100)} inputMode="decimal" className={input} />
                </label>
                <label className="flex flex-col gap-1 text-sm">
                  {w.minimum}
                  <input name="minimum" defaultValue={String(p.minimumMinor)} inputMode="numeric" className={input} />
                </label>
                <label className="flex flex-col gap-1 text-sm">
                  {w.round}
                  <input name="round" defaultValue={String(p.roundMinor)} inputMode="numeric" className={input} />
                </label>
                <SubmitButton variant="secondary">{w.save}</SubmitButton>
                {example !== null && (
                  <p className="text-caption text-muted sm:col-span-5">
                    {w.example.replace("{price}", formatMoney(example, p.currency, locale))}
                  </p>
                )}
              </ActionForm>
              </PhoneRow>
            );
          })}
        </div>
      </Card>

      {/* Round 67 (D837): on a phone the rest of the page is one card of rows, each saying where it stands and opening its card. */}
      <PhoneRows>
      <PhoneRow flat {...row} title={w.stores} sub={openToAll ? w.allOpen : countWords(stores.length, ph.storesSub)}>

      <Card title={w.stores} description={openToAll ? w.allOpen : w.openAllNote}>
        <div className="flex flex-col gap-4">
          <ActionForm action={domainsOpenAction}>
            {!openToAll && <input type="hidden" name="open" value="on" />}
            <SubmitButton variant="secondary">{openToAll ? w.closeAll : w.openAll}</SubmitButton>
          </ActionForm>
          {!openToAll && (
            <>
              <ActionForm action={storeDomainBuyingAction} className="flex flex-col gap-2 sm:flex-row sm:items-end">
                <input type="hidden" name="open" value="on" />
                <label className="flex flex-1 flex-col gap-1 text-sm">
                  {w.storeSlug}
                  <input name="slug" required className={input} autoCapitalize="off" spellCheck={false} />
                </label>
                <SubmitButton>{w.openStore}</SubmitButton>
              </ActionForm>
              {stores.length === 0 ? (
                <p className="text-body text-muted">{w.none}</p>
              ) : (
                <ul className="flex flex-col divide-y divide-line">
                  {stores.map((s) => (
                    <li key={s.id} className="flex items-center justify-between gap-3 py-2">
                      <span className="text-body text-ink">
                        {s.name} <span className="text-muted">{s.slug}</span>
                      </span>
                      <ActionForm action={storeDomainBuyingAction}>
                        <input type="hidden" name="slug" value={s.slug} />
                        <SubmitButton variant="secondary">{w.closeStore}</SubmitButton>
                      </ActionForm>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </div>
      </Card>
      </PhoneRow>

      <PhoneRow flat {...row} title={w.publicTitle} sub={sellsPublic ? ph.publicOn : ph.publicOff}>
      <Card title={w.publicTitle} description={sellsPublic ? w.publicOn : w.publicOff}>
        <ActionForm action={domainsPublicAction}>
          {!sellsPublic && <input type="hidden" name="on" value="on" />}
          <SubmitButton variant="secondary">{sellsPublic ? w.publicStop : w.publicStart}</SubmitButton>
        </ActionForm>
      </Card>
      </PhoneRow>

      <PhoneRow flat {...row} title={w.leadsTitle} sub={fillWords(ph.leadsSub, { came: leads.accounts, opened: leads.opened })}>
      <Card title={w.leadsTitle} description={w.leadsIntro}>
        <dl className="grid gap-4 sm:grid-cols-3">
          {(
            [
              [w.leadsAccounts, leads.accounts],
              [w.leadsAlone, leads.domainsAlone],
              [w.leadsRequested, leads.requested],
              [w.leadsOpened, leads.opened],
              [w.leadsIn90, leads.startedBefore90 > 0 ? `${leads.openedIn90} / ${leads.startedBefore90}` : w.leadsTooEarly],
            ] as const
          ).map(([label, value]) => (
            <div key={label} className="flex flex-col gap-1">
              <dt className="text-eyebrow text-muted">{label}</dt>
              <dd className="text-metric text-ink tabular-nums">{value}</dd>
            </div>
          ))}
        </dl>
      </Card>
      </PhoneRow>

      {inReview.length > 0 && (
        <PhoneRow flat defaultOpen {...row} title={w.reviewTitle} sub={countWords(inReview.length, ph.waiting)}>
        <Card title={w.reviewTitle} description={w.reviewIntro} count={inReview.length}>
          <ul className="flex flex-col divide-y divide-line">
            {inReview.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center gap-2 py-2">
                <span className="text-body-strong text-ink">{p.apex}</span>
                <Chip signal="warning">{w.reviewWhy[p.review]}</Chip>
                <span className="min-w-0 flex-1 text-caption text-muted">
                  {p.holder} · {p.status}
                  {p.vatNumber ? ` · ${p.vatNumber}` : ""} · {date(p.createdAt)}
                </span>
                <ActionForm action={reviewDomainAction} className="flex gap-2">
                  <input type="hidden" name="purchase" value={p.id} />
                  <SubmitButton name="answer" value="approve">
                    {w.approve}
                  </SubmitButton>
                  <SubmitButton name="answer" value="refuse" variant="secondary">
                    {w.refuse}
                  </SubmitButton>
                </ActionForm>
              </li>
            ))}
          </ul>
        </Card>
        </PhoneRow>
      )}

      <PhoneRow flat {...row} title={w.purchases} sub={purchases.length === 0 ? ph.none : countWords(purchases.length, ph.needLook)}>
      <Card title={w.purchases}>
        {purchases.length === 0 ? (
          <p className="text-body text-muted">{w.none}</p>
        ) : (
          <ul className="flex flex-col divide-y divide-line">
            {purchases.map((p, i) => (
              <li key={`${p.apex}-${i}`} className="flex flex-col gap-1 py-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-body-strong text-ink">{p.apex}</span>
                  <Chip signal={p.status === "failed" ? "danger" : "warning"}>{p.status}</Chip>
                  <span className="text-caption text-muted">
                    {p.store} · {p.kind} · {date(p.createdAt)} · {p.tries}
                  </span>
                </div>
                {p.problem && <p className="text-caption text-muted">{p.problem}</p>}
              </li>
            ))}
          </ul>
        )}
      </Card>
      </PhoneRow>

      <PhoneRow flat last {...row} title={w.registrations} sub={registrations.length === 0 ? ph.noneYet : countWords(registrations.length, ph.registered)}>
      <Card title={w.registrations} count={registrations.length}>
        {registrations.length === 0 ? (
          <p className="text-body text-muted">{w.none}</p>
        ) : (
          <ul className="flex flex-col divide-y divide-line">
            {registrations.map((r) => (
              <li key={r.apex} className="flex flex-wrap items-center gap-2 py-2">
                <span className="text-body-strong text-ink">{r.apex}</span>
                <span className="text-caption text-muted">
                  {r.store} · {r.status}
                  {r.expiresAt ? ` · ${date(r.expiresAt)}` : ""}
                  {r.renew ? "" : " · ✕"}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>
      </PhoneRow>
      </PhoneRows>
    </div>
  );
}
