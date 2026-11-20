import type { ReactNode } from "react";

import { dateIn, PLATFORM_TIME_ZONE } from "@/lib/dates";
import {
  bestExtensionSaving,
  extensionComparison,
  extensionOffer,
  offerCurrency,
  paidMinor,
  type BundleCard,
  type ExtensionCard,
  type ExtensionCardPrice,
  type PublicExtensions,
} from "@/lib/extension-offer";
import { t } from "@/lib/i18n";
import { formatMoney } from "@/lib/money";
import type { ExtensionsBlock } from "@/lib/page-content";
import { langOfLocale, platformPath } from "@/lib/platform-lang";
import { platformText, type PlatformMessages } from "@/lib/platform-text";
import type { PlanInterval } from "@/lib/plans";

import { buttonLook } from "./page-block";
import { IntervalSwitch } from "./plans-view";

// Written out whole so Tailwind finds every class; from Large, by the store's screen sizes (D179), as the Plans block.
const COLUMNS = ["", "kzb-lg-cols-1", "kzb-lg-cols-2", "kzb-lg-cols-3", "kzb-lg-cols-4"] as const;

type W = PlatformMessages["extensions"];
type M = ReturnType<typeof t>["plans"];

/**
 * Kaizena Flow's extensions (D748 E8, `docs/extensions.md` 11): a card for each extension on offer with its price (the founding price, for how
 * long and the price after, while founding prices are offered), what it includes, which plans include it, whether it is sold on its own and a
 * free trial; under them the bundles with what each saves. Prices are what accounts pay Kaizena Flow, without VAT. As the Plans block, the
 * block chooses which price leads (monthly with the yearly under it, one of them, or a switch for visitors: both sets drawn, the radio chosen
 * showing one by CSS alone), one card to recommend and a comparison table under the cards. Pure of data fetching: `ExtensionsSection` reads
 * the catalogue.
 */
export function ExtensionsView({ block, data, lang = "en", now }: { block: ExtensionsBlock; data: PublicExtensions; lang?: string; now?: Date }) {
  const site = langOfLocale(lang) ?? "en";
  const w = platformText(site).extensions;
  const m = t(lang).plans;
  const currency = offerCurrency(data, block.currency);
  if (!currency) return null;
  const offer = (interval?: PlanInterval) => extensionOffer(data, currency, now, block.hide, { interval, highlightId: block.highlightId });
  const shown = offer(block.switcher ? "month" : block.interval);
  const yearly = block.switcher ? offer("year") : null;
  const bundlesOf = (set: { bundles: BundleCard[] }) => (block.bundles === false ? [] : set.bundles);
  // Every extension and bundle switched off on the block (`hide`): nothing to draw.
  if (shown.extensions.length === 0 && bundlesOf(shown).length === 0) return null;
  const href = platformPath(site, block.buttonHref || "/sign-up");
  const label = block.buttonLabel || w.trial;
  const money = (minor: number) => formatMoney(minor, currency, lang, { decimals: block.decimals });
  const founding = [...shown.extensions, ...(yearly?.extensions ?? [])].some((e) => e.price.foundingMinor !== null) && data.founding.until;
  const props = { money, months: data.founding.months, href, label, w, m };
  const table = block.comparison ? extensionComparison(data, { extensions: shown.extensions, bundles: bundlesOf(shown) }) : null;
  // Each set of cards names its headings apart: with the switch both are on the page.
  const cards = (set: { extensions: ExtensionCard[]; bundles: BundleCard[] }, key = "") => (
    <>
      {set.extensions.length > 0 && (
        <div className={`grid gap-4 kzb-md-cols-2 ${COLUMNS[Math.min(set.extensions.length, 3)]}`}>
          {set.extensions.map((card) => (
            <ExtensionCardView key={card.id} headingId={`extension-${key}${card.id}`} card={card} {...props} />
          ))}
        </div>
      )}
      {bundlesOf(set).length > 0 && (
        <section aria-labelledby={`bundles-${key}${block.id}`} className="flex flex-col gap-4">
          <h3 id={`bundles-${key}${block.id}`} className="text-xl font-semibold" data-kz-text="name">
            {w.bundles}
          </h3>
          <div className={`grid gap-4 kzb-md-cols-2 ${COLUMNS[Math.min(bundlesOf(set).length, 3)]}`}>
            {bundlesOf(set).map((card) => (
              <BundleCardView key={card.id} headingId={`bundle-${key}${card.id}`} card={card} {...props} />
            ))}
          </div>
        </section>
      )}
    </>
  );
  const yearlyCards = yearly ? [...yearly.extensions, ...bundlesOf(yearly)] : [];

  return (
    <div className="flex flex-col gap-10">
      {founding && (
        <p className="self-center rounded-full bg-accent px-4 py-1 text-sm font-medium text-accent-foreground">
          {w.foundingUntil(dateIn(PLATFORM_TIME_ZONE, new Date(new Date(data.founding.until!).getTime() - 1).toISOString(), "dayMonth", lang))}
        </p>
      )}
      {yearly ? (
        <div data-plan-switch="" className="flex flex-col gap-8">
          <IntervalSwitch
            name={`extensions-${block.id}`}
            start={block.interval === "year" ? "year" : "month"}
            saving={bestExtensionSaving(yearlyCards)}
            allSame={new Set(yearlyCards.map((c) => c.yearlySavingPercent).filter((p) => p !== null)).size === 1}
            m={m}
          />
          <div data-plan-panel="month" className="flex flex-col gap-10">
            {cards(shown, "month-")}
          </div>
          <div data-plan-panel="year" className="flex flex-col gap-10">
            {cards(yearly, "year-")}
          </div>
        </div>
      ) : (
        cards(shown)
      )}
      {table && table.rows.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full min-w-120 border-collapse text-left text-sm">
            <caption className="pb-3 text-left text-lg font-semibold">{w.compare}</caption>
            <thead>
              <tr className="border-b border-border">
                <th scope="col" className="py-2 pr-4 font-normal text-muted">
                  {w.extension}
                </th>
                {table.columns.map((column) => (
                  <th key={column.id} scope="col" className="px-3 py-2 text-center font-semibold">
                    {column.name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {table.rows.map((row) => (
                <tr key={row.id} className="border-b border-border last:border-0">
                  <th scope="row" className="py-2 pr-4 font-normal">
                    {row.name}
                  </th>
                  {row.included.map((has, index) => (
                    <td key={table.columns[index].id} className="px-3 py-2 text-center">
                      <span aria-hidden="true">{has ? "✓" : "–"}</span>
                      <span className="sr-only">{has ? m.included : m.notIncluded}</span>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

type CardProps = { money: (minor: number) => string; months: number; href: string; label: string; w: W; m: M };

/**
 * A card's prices, as the Plans block's (D481): it leads with a month (a yearly price as its twelfth, and what the year comes to under it);
 * the founding price while offered, for how long and the price after; the yearly price under the monthly one when both show, and what it saves.
 */
function PriceLines({ card, money, months, w, m }: Pick<CardProps, "money" | "months" | "w" | "m"> & { card: ExtensionCard | BundleCard }) {
  const { price, other } = card;
  const paid = paidMinor(price);
  const every = (p: ExtensionCardPrice) => (p.interval === "year" ? m.perYear : m.perMonth);
  return (
    <div>
      <p className="text-3xl font-semibold" data-kz-text="price">
        {money(price.interval === "year" ? Math.round(paid / 12) : paid)} <span className="text-base font-normal text-muted">{w.perMonth}</span>
      </p>
      {price.interval === "year" && <p className="text-sm text-muted">{m.billedYearly(money(paid))}</p>}
      {price.foundingMinor !== null && (
        <p className="text-sm">
          <span className="sr-only">{w.wasPrice} </span>
          {w.foundingThen(months, `${money(price.amountMinor)} ${every(price)}`)}
        </p>
      )}
      <p className="text-xs text-muted">{w.exVat}</p>
      {other && <p className="mt-1 text-sm">{m.yearlyPrice(money(paidMinor(other)))}</p>}
      {card.yearlySavingPercent !== null && <p className="text-sm font-medium text-accent">{m.saveYearly(String(card.yearlySavingPercent))}</p>}
    </div>
  );
}

/** A card's frame: the one the block recommends ringed and marked, as the Plans block's chosen plan. */
function CardFrame({ headingId, highlighted, w, children }: { headingId: string; highlighted: boolean; w: W; children: ReactNode }) {
  return (
    <section aria-labelledby={headingId} className={`relative flex flex-col gap-4 rounded-lg border bg-background p-6 ${highlighted ? "border-accent ring-2 ring-accent" : "border-border"}`}>
      {highlighted && <p className="absolute -top-3 left-6 rounded-full bg-accent px-3 py-0.5 text-xs font-medium text-accent-foreground">{w.recommended}</p>}
      {children}
    </section>
  );
}

function CardButton({ href, label, highlighted, name }: { href: string; label: string; highlighted: boolean; name: string }) {
  const look = buttonLook({ variant: highlighted ? "filled" : "outline" }, true);
  return (
    <a href={href} className={`mt-auto ${look.className}`} style={look.style} data-kz-text="button">
      {label}
      <span className="sr-only"> – {name}</span>
    </a>
  );
}

function ExtensionCardView({ headingId, card, money, months, href, label, w, m }: CardProps & { headingId: string; card: ExtensionCard }) {
  const included = card.includedIn.plans.length === 0 ? null : card.includedIn.andUp ? w.includedFrom(card.includedIn.plans[0]) : w.includedIn(card.includedIn.plans.join(", "));
  return (
    <CardFrame headingId={headingId} highlighted={card.highlighted} w={w}>
      <div>
        <h3 id={headingId} className="text-xl font-semibold" data-kz-text="name">
          {card.name}
        </h3>
        {card.description && <p className="mt-1 text-sm text-muted">{card.description}</p>}
      </div>
      <PriceLines card={card} money={money} months={months} w={w} m={m} />
      <ul className="flex flex-col gap-1 text-sm" data-kz-text="meta">
        <li>{card.includes}</li>
        {included && <li>{included}</li>}
        {card.standalone && <li>{w.standalone}</li>}
      </ul>
      <CardButton href={href} label={label} highlighted={card.highlighted} name={card.name} />
    </CardFrame>
  );
}

function BundleCardView({ headingId, card, money, months, href, label, w, m }: CardProps & { headingId: string; card: BundleCard }) {
  return (
    <CardFrame headingId={headingId} highlighted={card.highlighted} w={w}>
      <div>
        <h4 id={headingId} className="text-xl font-semibold" data-kz-text="name">
          {card.name}
        </h4>
        {card.description && <p className="mt-1 text-sm text-muted">{card.description}</p>}
      </div>
      <PriceLines card={card} money={money} months={months} w={w} m={m} />
      <ul className="flex flex-col gap-1 text-sm" data-kz-text="meta">
        <li>{w.holds(card.members.join(", "))}</li>
        {card.savingMinor !== null && card.savingMinor > 0 && (
          <li className="font-medium text-accent">{(card.price.interval === "year" ? w.savesYear : w.saves)(money(card.savingMinor))}</li>
        )}
      </ul>
      <CardButton href={href} label={label} highlighted={card.highlighted} name={card.name} />
    </CardFrame>
  );
}
