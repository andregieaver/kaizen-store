import Link from "next/link";

import {
  STORE_KINDS,
  THEME_FEATURES,
  THEME_STYLES,
  filterThemes,
  showcaseTrades,
  themeFilterHref,
  type ThemeFilter,
  type ThemeStoreCard,
} from "@/lib/theme-store";
import { themeStorePath } from "@/lib/theme-host";

/**
 * The theme store's list (`docs/theme-phase-3.md` step 1): a card per theme under one bar of filters (kind of store, style, what it
 * includes), plain links in small menus, so it works without JavaScript and every filtered list has an address. Drawn in Kaizena
 * Flow's own theme. Server-drawn.
 */

/** "a, b and c". */
const listWords = (words: string[]): string => (words.length < 2 ? words.join("") : `${words.slice(0, -1).join(", ")} and ${words.at(-1)}`);

/** "Shown on a beauty store", "Shown on an electronics store", "Shown on food and drink and home stores". */
function shownOn(trades: string[]): string {
  const words = trades.map((t) => t.toLowerCase());
  if (words.length === 1) return `Shown on ${/^[aeiou]/.test(words[0]) ? "an" : "a"} ${words[0]} store`;
  return `Shown on ${listWords(words)} stores`;
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

/** A theme's card: the admin's picture, else a photograph of it on the demo store, else its colours (a theme with neither). */
export function ThemeCard({ card }: { card: ThemeStoreCard }) {
  const picture = card.pictureUrl ?? card.shotUrl;
  // The trades its looks are shown on (`docs/theme-showcase-phase-1.md` step 3), only those whose demo store is published.
  const trades = showcaseTrades(card.looks);
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
          <Link href={themeStorePath(card.slug)} className="after:absolute after:inset-0 hover:underline">
            {card.title}
          </Link>
        </h2>
        {card.summary && <p className="text-sm text-muted">{card.summary}</p>}
        {trades.length > 0 && <p className="text-sm text-muted">{shownOn(trades)}</p>}
        <p className="mt-auto text-sm">
          <span className="font-medium">Free</span>
          {card.listing.styles.length > 0 && <span className="text-muted"> · {card.listing.styles.map((s) => THEME_STYLES[s]).join(", ")}</span>}
          {card.presets.length > 0 && <span className="text-muted"> · {card.presets.length + 1} presets</span>}
        </p>
      </div>
    </li>
  );
}

/**
 * One filter as a small menu in the bar: closed it names the choice, open it lists the others as links (no JavaScript needed). The
 * menus share a name, so opening one closes the others, and each is keyed by its choice, so choosing closes it.
 */
function FilterMenu<K extends string>({ label, options, chosen, href }: { label: string; options: Record<K, string>; chosen: K | null; href: (key: K | null) => string }) {
  return (
    <details key={chosen ?? "any"} name="theme-filter" className="group relative">
      <summary className="inline-flex min-h-10 cursor-pointer list-none items-center gap-2 rounded-full border border-border px-4 text-sm marker:hidden [&::-webkit-details-marker]:hidden">
        <span className="text-muted">{label}</span>
        <span className="font-medium">{chosen ? options[chosen] : "Any"}</span>
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
              {key ? options[key] : "Any"}
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
export function ThemeStoreList({ cards, filter }: { cards: ThemeStoreCard[]; filter: ThemeFilter }) {
  const shown = filterThemes(cards, filter);
  const filtered = Boolean(filter.kind || filter.style || filter.feature);
  return (
    <div className="flex flex-col gap-6">
      <nav aria-label="Filter themes" className="flex flex-wrap items-center gap-2">
        <FilterMenu label="Store" options={STORE_KINDS} chosen={filter.kind} href={(kind) => themeFilterHref(filter, { kind })} />
        <FilterMenu label="Style" options={THEME_STYLES} chosen={filter.style} href={(style) => themeFilterHref(filter, { style })} />
        <FilterMenu label="Includes" options={THEME_FEATURES} chosen={filter.feature} href={(feature) => themeFilterHref(filter, { feature })} />
        {filtered && (
          <Link href={themeFilterHref(filter, { kind: null, style: null, feature: null })} className="inline-flex min-h-10 items-center px-2 text-sm underline underline-offset-2">
            Clear filters
          </Link>
        )}
        <p role="status" className="ml-auto text-sm text-muted">
          {shown.length === 0
            ? cards.length === 0
              ? "No themes yet."
              : "No theme matches all of these."
            : `${shown.length} ${shown.length === 1 ? "theme" : "themes"}, all free`}
        </p>
      </nav>
      {shown.length > 0 && (
        <ul className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {shown.map((card) => (
            <ThemeCard key={card.id} card={card} />
          ))}
        </ul>
      )}
    </div>
  );
}
