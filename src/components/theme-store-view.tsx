import Link from "next/link";

import { PLATFORM_LANG_FACTS, type PlatformLang } from "@/lib/platform-lang";
import { platformText } from "@/lib/platform-text";
import { cardPicture, filterThemes, themeFilterHref, type ThemeFilter, type ThemeLook, type ThemeStoreCard } from "@/lib/theme-store";
import { themeStorePath } from "@/lib/theme-host";
import { isPremium, priceText } from "@/lib/theme-prices";

import { SwatchDot } from "./theme-swatch";

/**
 * The theme store's list (`docs/theme-phase-3.md` step 1): a card per theme under one bar of filters (kind of store, style, what it
 * includes), plain links in small menus, so it works without JavaScript and every filtered list has an address. Drawn in Kaizena
 * Flow's own theme, in the page's language (D312 P3: `platformText(lang).themeStore`). Server-drawn.
 */

/** The trades a theme's looks are shown on, each once, in the page's language: only a content pack has one. */
function tradesOf(looks: readonly ThemeLook[], lang: PlatformLang): string[] {
  const trades = platformText(lang).themeStore.trades;
  return [...new Set(looks.flatMap((look) => (look.showcase?.pack ? [trades[look.showcase.pack]] : [])))];
}

/** A theme card's price: free, or its first price (the platform's own currency first), written as the language writes money. */
export function cardPriceIn(prices: ThemeStoreCard["prices"], lang: PlatformLang): string {
  return prices && isPremium(prices) ? priceText(prices[0], PLATFORM_LANG_FACTS[lang].locale) : platformText(lang).themeStore.free;
}

function Swatch({ card }: { card: ThemeStoreCard }) {
  const s = card.swatch;
  return (
    <div aria-hidden="true" className="flex aspect-[4/3] flex-col justify-between rounded-t-lg p-5" style={{ background: s.background, color: s.text }}>
      <span className="text-2xl" style={s.heading ? { fontFamily: `"${s.heading}", serif` } : undefined}>
        {card.title}
      </span>
      <div className="flex items-center gap-2">
        <span className="h-8 w-20 rounded-full" style={{ background: s.accent }} />
        <span className="h-8 w-8 rounded-full" style={{ background: s.surface }} />
        <span className="h-8 w-8 rounded-full" style={{ background: s.text }} />
      </div>
    </div>
  );
}

/** A theme's card: the admin's picture, else a photograph of it on its demo store (`cardPicture()`), else its colours. */
export function ThemeCard({ card, lang = "en" }: { card: ThemeStoreCard; lang?: PlatformLang }) {
  const w = platformText(lang).themeStore;
  const picture = cardPicture(card);
  // The trades its looks are shown on (`docs/theme-showcase-phase-1.md` step 3), only those whose demo store is published.
  const trades = tradesOf(card.looks, lang);
  return (
    <li className="relative flex flex-col overflow-hidden rounded-lg border border-border bg-background">
      {picture ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={picture} alt="" width={800} height={600} className="aspect-[4/3] w-full border-b border-border object-cover object-top" loading="lazy" />
      ) : (
        <Swatch card={card} />
      )}
      <div className="flex flex-1 flex-col gap-2 p-4">
        <h2 className="text-lg font-semibold">
          <Link href={themeStorePath(card.slug, lang)} className="after:absolute after:inset-0 hover:underline">
            {card.title}
          </Link>
        </h2>
        {card.summary && (
          <p className="text-sm text-muted" {...(lang !== "en" && card.english?.summary ? { lang: "en" } : {})}>
            {card.summary}
          </p>
        )}
        {/* Its looks as dots in their colours (D275); the count of presets below says it in words. */}
        {card.looks.length > 1 && (
          <p className="flex gap-1.5" data-look-swatches="">
            {card.looks.map((look) => (
              <SwatchDot key={look.key ?? ""} swatch={look.swatch ?? card.swatch} size="sm" />
            ))}
          </p>
        )}
        {trades.length > 0 && <p className="text-sm text-muted">{w.shownOn(trades)}</p>}
        <p className="mt-auto text-sm">
          <span className="font-medium">{cardPriceIn(card.prices, lang)}</span>
          {card.listing.styles.length > 0 && <span className="text-muted"> · {card.listing.styles.map((s) => w.styles[s]).join(", ")}</span>}
          {card.presets.length > 0 && <span className="text-muted"> · {w.presets(card.presets.length + 1)}</span>}
        </p>
      </div>
    </li>
  );
}

/**
 * One filter as a small menu in the bar: closed it names the choice, open it lists the others as links (no JavaScript needed). The
 * menus share a name, so opening one closes the others, and each is keyed by its choice, so choosing closes it.
 */
function FilterMenu<K extends string>({
  label,
  any,
  options,
  chosen,
  href,
}: {
  label: string;
  any: string;
  options: Record<K, string>;
  chosen: K | null;
  href: (key: K | null) => string;
}) {
  return (
    <details key={chosen ?? "any"} name="theme-filter" className="group relative">
      <summary className="inline-flex min-h-10 cursor-pointer list-none items-center gap-2 rounded-full border border-border px-4 text-sm marker:hidden [&::-webkit-details-marker]:hidden">
        <span className="text-muted">{label}</span>
        <span className="font-medium">{chosen ? options[chosen] : any}</span>
        <svg aria-hidden="true" viewBox="0 0 12 12" className="size-3 transition-transform group-open:rotate-180">
          <path d="M2 4l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.5" />
        </svg>
      </summary>
      <ul className="absolute left-0 top-full z-20 mt-2 flex min-w-56 flex-col rounded-lg border border-border bg-background p-1 shadow-lg">
        {([null, ...Object.keys(options)] as (K | null)[]).map((key) => (
          <li key={key ?? "all"}>
            <Link
              href={href(key)}
              aria-current={chosen === key ? "page" : undefined}
              className="flex min-h-10 items-center rounded-md px-3 text-sm hover:bg-foreground/5 aria-[current=page]:font-medium"
            >
              {key ? options[key] : any}
            </Link>
          </li>
        ))}
      </ul>
    </details>
  );
}

/**
 * The themes first, the filters as one bar above them: three small menus, the count and a way to clear them (the theme showcase plan's
 * quick fixes). Every filtered list keeps its own address.
 */
export function ThemeStoreList({ cards, filter, lang = "en" }: { cards: ThemeStoreCard[]; filter: ThemeFilter; lang?: PlatformLang }) {
  const w = platformText(lang).themeStore;
  const shown = filterThemes(cards, filter);
  const filtered = Boolean(filter.kind || filter.style || filter.feature);
  const href = (change: Partial<ThemeFilter>) => themeFilterHref(filter, change, lang);
  return (
    <div className="flex flex-col gap-6">
      <nav aria-label={w.filters} className="flex flex-wrap items-center gap-2">
        <FilterMenu label={w.store} any={w.any} options={w.kinds} chosen={filter.kind} href={(kind) => href({ kind })} />
        <FilterMenu label={w.style} any={w.any} options={w.styles} chosen={filter.style} href={(style) => href({ style })} />
        <FilterMenu label={w.includes} any={w.any} options={w.features} chosen={filter.feature} href={(feature) => href({ feature })} />
        {filtered && (
          <Link href={href({ kind: null, style: null, feature: null })} className="inline-flex min-h-10 items-center px-2 text-sm underline underline-offset-2">
            {w.clear}
          </Link>
        )}
        <p role="status" className="ml-auto text-sm text-muted">
          {shown.length === 0 ? (cards.length === 0 ? w.none : w.noMatch) : w.count(shown.length, shown.every((card) => !isPremium(card.prices ?? [])))}
        </p>
      </nav>
      {shown.length > 0 && (
        <ul className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {shown.map((card) => (
            <ThemeCard key={card.id} card={card} lang={lang} />
          ))}
        </ul>
      )}
    </div>
  );
}
