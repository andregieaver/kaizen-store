import type { Metadata } from "next";
import { connection } from "next/server";

import { ActionForm, SubmitButton } from "@/components/admin/action-form";
import { Card, Chip, PageHeader } from "@/components/admin/ui";
import { ADMIN_LANG_FACTS, adminLangOf } from "@/lib/admin-lang";
import { adminText } from "@/lib/admin-text";
import { domainPrice } from "@/lib/domain-prices";
import { formatMoney } from "@/lib/money";
import { requirePlatformAdmin } from "@/server/auth";
import { allRegistrations, domainsOpenToAll, purchasesNeedingALook, storesBuyingDomains } from "@/server/domain-admin";
import { domainPricingRows, latestEurRates } from "@/server/domain-prices";

import { domainsOpenAction, saveDomainPricingAction, storeDomainBuyingAction } from "./actions";

export const metadata: Metadata = { title: "Domains" };

const input = "min-h-10 w-full rounded-md border border-line bg-card px-3 text-sm";

/**
 * Domains stores buy through Kaizena Flow (D315): the pricing rules per currency (never a price in code), which stores may buy before buying
 * opens to all (decision 9), every registration and the purchases that need a look.
 */
export default async function PlatformDomainsPage() {
  await connection();
  const account = await requirePlatformAdmin();
  const lang = adminLangOf(account.adminLocale);
  const locale = ADMIN_LANG_FACTS[lang].locale;
  const w = adminText(lang, "domains").platform;
  const [pricing, { rates, day }, openToAll, stores, registrations, purchases] = await Promise.all([
    domainPricingRows(),
    latestEurRates(),
    domainsOpenToAll(),
    storesBuyingDomains(),
    allRegistrations(),
    purchasesNeedingALook(),
  ]);
  const date = (iso: string) => new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeZone: "Europe/Oslo" }).format(new Date(iso));

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={w.title} description={w.intro.replace("{date}", day ? date(day) : w.noRate)} />

      <Card title={w.pricing}>
        <div className="flex flex-col gap-4">
          {pricing.map((p) => {
            const example = domainPrice("11.25", "USD", 1, p, rates);
            return (
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
            );
          })}
        </div>
      </Card>

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
    </div>
  );
}
