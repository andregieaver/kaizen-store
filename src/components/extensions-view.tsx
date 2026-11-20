import { dateIn, PLATFORM_TIME_ZONE } from "@/lib/dates";
import { extensionOffer, offerCurrency, type BundleCard, type ExtensionCard, type ExtensionCardPrice, type PublicExtensions } from "@/lib/extension-offer";
import { formatMoney } from "@/lib/money";
import type { ExtensionsBlock } from "@/lib/page-content";
import { langOfLocale, platformPath } from "@/lib/platform-lang";
import { platformText, type PlatformMessages } from "@/lib/platform-text";

import { buttonLook } from "./page-block";

// Written out whole so Tailwind finds every class; from Large, by the store's screen sizes (D179), as the Plans block.
const COLUMNS = ["", "kzb-lg-cols-1", "kzb-lg-cols-2", "kzb-lg-cols-3", "kzb-lg-cols-4"] as const;

type W = PlatformMessages["extensions"];

/**
 * Kaizena Flow's extensions (D748 E8, `docs/extensions.md` 11): a card for each extension on offer with its price (the founding price, for how
 * long and the price after, while founding prices are offered), what it includes, which plans include it, whether it is sold on its own and a
 * free trial; under them the bundles with what each saves. Prices are what accounts pay Kaizena Flow, without VAT. Pure of data fetching:
 * `ExtensionsSection` reads the catalogue.
 */
export function ExtensionsView({ block, data, lang = "en", now }: { block: ExtensionsBlock; data: PublicExtensions; lang?: string; now?: Date }) {
  const site = langOfLocale(lang) ?? "en";
  const w = platformText(site).extensions;
  const currency = offerCurrency(data, block.currency);
  if (!currency) return null;
  const { extensions, bundles } = extensionOffer(data, currency, now, block.hide);
  const href = platformPath(site, block.buttonHref || "/sign-up");
  const label = block.buttonLabel || w.trial;
  const money = (minor: number) => formatMoney(minor, currency, lang, { decimals: block.decimals });
  const look = buttonLook({ variant: "outline" }, true);
  const founding = extensions.some((e) => e.price.foundingMinor !== null) && data.founding.until;
  const shownBundles = block.bundles === false ? [] : bundles;
  // Every extension and bundle switched off on the block (`hide`): nothing to draw.
  if (extensions.length === 0 && shownBundles.length === 0) return null;

  return (
    <div className="flex flex-col gap-10">
      {founding && (
        <p className="self-center rounded-full bg-accent px-4 py-1 text-sm font-medium text-accent-foreground">
          {w.foundingUntil(dateIn(PLATFORM_TIME_ZONE, new Date(new Date(data.founding.until!).getTime() - 1).toISOString(), "dayMonth", lang))}
        </p>
      )}
      {extensions.length > 0 && (
        <div className={`grid gap-4 kzb-md-cols-2 ${COLUMNS[Math.min(extensions.length, 3)]}`}>
          {extensions.map((card) => (
            <ExtensionCardView key={card.id} card={card} money={money} months={data.founding.months} href={href} label={label} look={look} w={w} />
          ))}
        </div>
      )}
      {shownBundles.length > 0 && (
        <section aria-labelledby={`bundles-${block.id}`} className="flex flex-col gap-4">
          <h3 id={`bundles-${block.id}`} className="text-xl font-semibold" data-kz-text="name">
            {w.bundles}
          </h3>
          <div className={`grid gap-4 kzb-md-cols-2 ${COLUMNS[Math.min(shownBundles.length, 3)]}`}>
            {shownBundles.map((card) => (
              <BundleCardView key={card.id} card={card} money={money} months={data.founding.months} href={href} label={label} look={look} w={w} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

/** A price as a card leads with it: the founding price while offered, for how long and the price after; else the price. */
function PriceLines({ price, money, months, w }: { price: ExtensionCardPrice; money: (minor: number) => string; months: number; w: W }) {
  const shown = price.foundingMinor ?? price.amountMinor;
  return (
    <div>
      <p className="text-3xl font-semibold" data-kz-text="price">
        {money(shown)} <span className="text-base font-normal text-muted">{w.perMonth}</span>
      </p>
      {price.foundingMinor !== null && (
        <p className="text-sm">
          <span className="sr-only">{w.wasPrice} </span>
          {w.foundingThen(months, money(price.amountMinor))}
        </p>
      )}
      <p className="text-xs text-muted">{w.exVat}</p>
    </div>
  );
}

type CardProps = { money: (minor: number) => string; months: number; href: string; label: string; look: ReturnType<typeof buttonLook>; w: W };

function ExtensionCardView({ card, money, months, href, label, look, w }: CardProps & { card: ExtensionCard }) {
  const headingId = `extension-${card.id}`;
  const included = card.includedIn.plans.length === 0 ? null : card.includedIn.andUp ? w.includedFrom(card.includedIn.plans[0]) : w.includedIn(card.includedIn.plans.join(", "));
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-4 rounded-lg border border-border bg-background p-6">
      <div>
        <h3 id={headingId} className="text-xl font-semibold" data-kz-text="name">
          {card.name}
        </h3>
        {card.description && <p className="mt-1 text-sm text-muted">{card.description}</p>}
      </div>
      <PriceLines price={card.price} money={money} months={months} w={w} />
      <ul className="flex flex-col gap-1 text-sm" data-kz-text="meta">
        <li>{card.includes}</li>
        {included && <li>{included}</li>}
        {card.standalone && <li>{w.standalone}</li>}
      </ul>
      <a href={href} className={`mt-auto ${look.className}`} style={look.style} data-kz-text="button">
        {label}
      </a>
    </section>
  );
}

function BundleCardView({ card, money, months, href, label, look, w }: CardProps & { card: BundleCard }) {
  const headingId = `bundle-${card.id}`;
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-4 rounded-lg border border-border bg-background p-6">
      <div>
        <h4 id={headingId} className="text-xl font-semibold" data-kz-text="name">
          {card.name}
        </h4>
        {card.description && <p className="mt-1 text-sm text-muted">{card.description}</p>}
      </div>
      <PriceLines price={card.price} money={money} months={months} w={w} />
      <ul className="flex flex-col gap-1 text-sm" data-kz-text="meta">
        <li>{w.holds(card.members.join(", "))}</li>
        {card.savingMinor !== null && card.savingMinor > 0 && <li className="font-medium text-accent">{w.saves(money(card.savingMinor))}</li>}
      </ul>
      <a href={href} className={`mt-auto ${look.className}`} style={look.style} data-kz-text="button">
        {label}
      </a>
    </section>
  );
}
