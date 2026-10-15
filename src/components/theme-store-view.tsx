import Link from "next/link";

import {
  STORE_KINDS,
  THEME_FEATURES,
  THEME_STYLES,
  filterThemes,
  themeFilterHref,
  type ThemeFilter,
  type ThemeStoreCard,
} from "@/lib/theme-store";

/**
 * The theme store's list (`docs/theme-phase-3.md` step 1): filters as plain links (kind of store, style, what it includes), so it works
 * without JavaScript and every filtered list has an address; then a card per theme. Drawn in Kaizena Flow's own theme. Server-drawn.
 */

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

export function ThemeCard({ card }: { card: ThemeStoreCard }) {
  return (
    <li className="relative flex flex-col overflow-hidden rounded-lg border border-border bg-background">
      {card.pictureUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={card.pictureUrl} alt="" className="aspect-[4/3] w-full object-cover" loading="lazy" />
      ) : (
        <Swatch card={card} />
      )}
      <div className="flex flex-1 flex-col gap-2 p-4">
        <h2 className="text-lg font-semibold">
          <Link href={`/themes/${card.slug}`} className="after:absolute after:inset-0 hover:underline">
            {card.title}
          </Link>
        </h2>
        {card.summary && <p className="text-sm text-muted">{card.summary}</p>}
        <p className="mt-auto text-sm">
          <span className="font-medium">Free</span>
          {card.listing.styles.length > 0 && <span className="text-muted"> · {card.listing.styles.map((s) => THEME_STYLES[s]).join(", ")}</span>}
        </p>
      </div>
    </li>
  );
}

function FilterRow<K extends string>({ label, options, chosen, href }: { label: string; options: Record<K, string>; chosen: K | null; href: (key: K | null) => string }) {
  return (
    <div className="flex flex-col gap-2">
      <h2 className="text-sm font-medium">{label}</h2>
      <ul className="flex flex-wrap gap-2">
        {([null, ...Object.keys(options)] as (K | null)[]).map((key) => (
          <li key={key ?? "all"}>
            <Link
              href={href(key)}
              aria-current={chosen === key ? "page" : undefined}
              className="inline-flex min-h-10 items-center rounded-full border border-border px-3 text-sm aria-[current=page]:bg-foreground aria-[current=page]:text-background"
            >
              {key ? options[key] : "Any"}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function ThemeStoreList({ cards, filter }: { cards: ThemeStoreCard[]; filter: ThemeFilter }) {
  const shown = filterThemes(cards, filter);
  return (
    <div className="flex flex-col gap-8">
      <nav aria-label="Filter themes" className="flex flex-col gap-4">
        <FilterRow label="Kind of store" options={STORE_KINDS} chosen={filter.kind} href={(kind) => themeFilterHref(filter, { kind })} />
        <FilterRow label="Style" options={THEME_STYLES} chosen={filter.style} href={(style) => themeFilterHref(filter, { style })} />
        <FilterRow label="Includes" options={THEME_FEATURES} chosen={filter.feature} href={(feature) => themeFilterHref(filter, { feature })} />
      </nav>
      <p role="status" className="text-sm text-muted">
        {shown.length === 0
          ? cards.length === 0
            ? "No themes yet."
            : "No theme matches all of these. Take a filter away."
          : `${shown.length} ${shown.length === 1 ? "theme" : "themes"}, all free.`}
      </p>
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
