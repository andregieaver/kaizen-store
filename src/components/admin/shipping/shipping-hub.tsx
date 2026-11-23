import type { ReactNode } from "react";

import { countWords, fillWords } from "@/lib/admin-fill";
import type { ShippingMessages } from "@/lib/admin-messages/shipping.en";
import type { ShippingWarning } from "@/lib/shipping-methods";
import { warningWords } from "@/lib/shipping-warning-words";
import { DotChip } from "@/components/admin/home/home-parts";
import { AdminLink, Card, CARD_CLASS, Chip } from "@/components/admin/ui";

/**
 * The Shipping page, the section's hub (D237, `docs/wave-3-shipping-methods.md` 2.1; redrawn for Homer in D615): what needs a look first
 * (`shippingWarnings()`, computed and never stored), what delivery costs per country beside what a shopper sees at checkout, the other
 * ways to deliver as cards with their state and one action each (carriers, the store's own methods, pickup, local delivery), and a fold
 * for large or heavy catalogues (zones, profiles, the default weight). Presentational: the page reads, this draws.
 */

export type HubMarket = { code: string; name: string; currency: string; methods: number; activeMethods: number; zones: number; hasFlat: boolean };

/** A country's flat rate in words, formatted by the page (`null`: not set; a free-from of `null`: never free). */
export type HubPrice = { code: string; name: string; price: string | null; free: boolean; freeFrom: string | null };

export type ShippingHubProps = {
  base: string;
  markets: HubMarket[];
  /** The flat rates in words, per country; the first one with a price is the one the preview shows. */
  prices?: HubPrice[];
  /** Carriers connected with every detail they need. */
  carriers?: number;
  profiles: number;
  /** Products in a profile other than General. */
  profiledProducts: number;
  defaultWeightGrams: number;
  pickup: { places: number; active: number };
  local: { areas: number; active: number };
  warnings: ShippingWarning[];
  /** The flat rate's form and the default weight's form, drawn by the page (they post to its actions). */
  flatRateForm: ReactNode;
  defaultWeightForm: ReactNode;
  /** The hub's words in the admin's language (D312 A8). */
  words: ShippingMessages["hub"];
};

/** The page's sentence: what a shopper pays for delivery, its first part the one to read ("Shoppers in Norway pay 99 kr for delivery"). */
export function deliverySentence(prices: HubPrice[], words: ShippingMessages["hub"]): { lead: string; rest: string } {
  const w = words.sentence;
  const set = prices.filter((p) => p.price !== null);
  if (set.length === 0) return { lead: w.none, rest: w.noneMore };
  if (prices.length > 1) return { lead: fillWords(w.many, { n: set.length, total: prices.length }), rest: w.manyMore };
  const only = set[0];
  if (only.free) return { lead: fillWords(w.free, { market: only.name }), rest: "" };
  return {
    lead: fillWords(w.pay, { market: only.name, price: only.price ?? "" }),
    rest: only.freeFrom ? fillWords(w.freeFrom, { free: only.freeFrom }) : w.end,
  };
}

export function ShippingHubView({
  base,
  markets,
  prices = [],
  carriers = 0,
  profiles,
  profiledProducts,
  defaultWeightGrams,
  pickup,
  local,
  warnings,
  flatRateForm,
  defaultWeightForm,
  words: w,
}: ShippingHubProps) {
  const nameOf = (code: string) => markets.find((m) => m.code === code)?.name ?? code;
  const shown = prices.find((p) => p.price !== null);
  const methods = markets.reduce((n, m) => n + m.methods, 0);
  const zones = markets.reduce((n, m) => n + m.zones, 0);
  const firstMarket = markets[0]?.code;
  const integrations = base.replace(/\/settings\/shipping$/, "/integrations");
  return (
    <div className="flex flex-col gap-6">
      {warnings.length > 0 && (
        <section aria-labelledby="shipping-warnings" className="rounded-panel bg-warning-soft p-4 text-warning-text">
          <h2 id="shipping-warnings" className="text-body-strong">{w.needsLook}</h2>
          <ul className="mt-2 list-disc pl-5 text-sm">
            {warnings.map((warning, i) => (
              <li key={i}>{warningWords(warning, nameOf, w.warnings)}</li>
            ))}
          </ul>
        </section>
      )}

      <div className="flex flex-wrap items-stretch gap-5">
        <Card title={w.priceTitle} className="min-w-0 flex-[999_1_420px]">
          <div className="flex flex-col gap-3">
            {flatRateForm}
            <p className="text-sm text-muted">{w.priceNote}</p>
          </div>
        </Card>
        <section aria-labelledby="shipping-sees" className={`flex min-w-0 flex-[1_1_300px] flex-col gap-3 p-6 ${CARD_CLASS}`}>
          <h2 id="shipping-sees" className="text-body-strong text-ink">
            {shown ? fillWords(w.sees, { market: shown.name }) : w.seesAny}
          </h2>
          <div className="flex flex-col gap-2 rounded-md border border-line bg-sunken p-3.5">
            <span className="text-sm text-muted">{w.seesDelivery}</span>
            {shown ? (
              <>
                <span className="flex min-h-12 items-center gap-2.5 rounded-md border-2 border-brand bg-card px-3 text-sm text-ink">
                  <span aria-hidden className="size-3.5 flex-none rounded-full border-4 border-ink" />
                  <span className="flex-1">{w.seesOption}</span>
                  <span>{shown.free ? w.seesFreeAlways : shown.price}</span>
                </span>
                {!shown.free && shown.freeFrom && <span className="text-xs text-muted">{fillWords(w.seesFree, { free: shown.freeFrom })}</span>}
              </>
            ) : (
              <span className="text-sm text-ink-2">{w.seesNone}</span>
            )}
          </div>
        </section>
      </div>

      <section aria-labelledby="shipping-ways" className="flex flex-col gap-3">
        <h2 id="shipping-ways" className="text-body-strong text-ink">
          {w.waysTitle} <span className="text-sm font-normal text-muted">{w.waysSub}</span>
        </h2>
        <div className="grid grid-cols-[repeat(auto-fit,minmax(min(250px,100%),1fr))] gap-3">
          <Way title={w.carriers.title} text={w.carriers.text} state={carriers === 0 ? w.carriers.none : countWords(carriers, w.carriers.some)} on={carriers > 0} href={integrations} action={carriers === 0 ? w.carriers.action : w.carriers.manage} />
          <Way
            title={w.own.title}
            text={w.own.text}
            state={methods === 0 ? w.own.none : null}
            on={methods > 0}
            href={`${base}/methods${firstMarket ? `?market=${firstMarket}` : ""}`}
            action={methods === 0 ? w.own.action : w.own.see}
          >
            {methods > 0 && (
              <ul aria-label={w.methodsByCountry} className="flex flex-col gap-1 text-sm">
                {markets.map((m) => (
                  <li key={m.code} className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <AdminLink href={`${base}/methods?market=${m.code}`} className="text-ink underline-offset-2 hover:underline">
                      {m.name}
                    </AdminLink>
                    <span className="text-ink-2">
                      {m.methods === 0 ? w.noMethods : `${countWords(m.activeMethods, w.offered)}${m.methods > m.activeMethods ? fillWords(w.off, { n: m.methods - m.activeMethods }) : ""}`}
                    </span>
                    {!m.hasFlat && <Chip signal="warning">{w.noFlat}</Chip>}
                  </li>
                ))}
              </ul>
            )}
          </Way>
          <Way
            title={w.pickupCard.title}
            text={w.pickupCard.text}
            state={pickup.places === 0 ? w.pickupCard.none : countWords(pickup.active, w.offeredAt, { total: pickup.places })}
            on={pickup.active > 0}
            href={`${base}/pickup`}
            action={pickup.places === 0 ? w.pickupCard.action : w.pickupCard.manage}
          />
          <Way
            title={w.localCard.title}
            text={w.localCard.text}
            state={local.areas === 0 ? w.noAreas : countWords(local.active, w.areasOn, { total: local.areas })}
            on={local.active > 0}
            href={`${base}/local`}
            action={local.areas === 0 ? w.localCard.action : w.localCard.manage}
          />
        </div>
      </section>

      <details className={`group px-6 py-4 ${CARD_CLASS}`}>
        <summary className="flex min-h-9 cursor-pointer flex-wrap items-baseline gap-x-2 text-body text-ink">
          {w.big.title}
          <span className="text-sm text-muted">
            {fillWords(w.big.facts, {
              zones: zones === 0 ? w.big.noZones : countWords(zones, w.zones),
              profiles: profiles === 0 ? w.big.generalOnly : countWords(profiles, w.profiles),
              grams: defaultWeightGrams,
            })}
          </span>
        </summary>
        <div className="mt-4 grid gap-5 lg:grid-cols-3">
          <div className="flex flex-col gap-2">
            <h3 className="text-body-strong text-ink">{w.zonesTitle}</h3>
            <p className="text-sm text-ink-2">{w.zonesDescription}</p>
            <p className="text-sm text-ink-2">{countWords(zones, w.zonesInAll)}</p>
            <AdminLink href={`${base}/zones`} className="text-sm font-medium text-brand-text underline-offset-2 hover:underline">
              {w.big.zonesLink}
            </AdminLink>
          </div>
          <div className="flex flex-col gap-2">
            <h3 className="text-body-strong text-ink">{w.profilesTitle}</h3>
            <p className="text-sm text-ink-2">{w.profilesDescription}</p>
            <p className="text-sm text-ink-2">{fillWords(w.profilesLine, { profiles: countWords(profiles, w.profiles), products: countWords(profiledProducts, w.products) })}</p>
            <AdminLink href={`${base}/profiles`} className="text-sm font-medium text-brand-text underline-offset-2 hover:underline">
              {w.big.profilesLink}
            </AdminLink>
          </div>
          <div className="flex flex-col gap-2">
            <h3 className="text-body-strong text-ink">{w.weightTitle}</h3>
            <p className="text-sm text-ink-2">{fillWords(w.weightDescription, { grams: defaultWeightGrams })}</p>
            {defaultWeightForm}
          </div>
        </div>
      </details>
    </div>
  );
}

/** One way to deliver: what it is, its state and one action. */
function Way({ title, text, state, on, href, action, children }: { title: string; text: string; state: string | null; on: boolean; href: string; action: string; children?: ReactNode }) {
  return (
    <article className={`flex flex-col gap-2 p-4.5 ${CARD_CLASS}`}>
      <h3 className="text-body text-ink">{title}</h3>
      <p className="text-sm text-ink-2">{text}</p>
      {state && <DotChip tone={on ? "positive" : "neutral"}>{state}</DotChip>}
      {children}
      <AdminLink href={href} className="mt-auto self-start pt-1 text-sm font-medium text-brand-text underline-offset-2 hover:underline">
        {action}
      </AdminLink>
    </article>
  );
}
