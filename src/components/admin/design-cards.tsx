import { designLookValue, type DesignCard } from "@/lib/design-presets";
import { pricesText } from "@/lib/theme-prices";
import { platformEn, type PlatformMessages } from "@/lib/messages/platform-en";

/** The cards' own words; English unless the page passes another language's (sign-up in Norwegian, D312). */
export type DesignCardWords = PlatformMessages["themeCards"];

/** The Preview link of a theme: a new window, without giving it this page. */
export function DesignPreviewLink({ href, title, className, words = platformEn.themeCards }: { href: string; title: string; className?: string; words?: DesignCardWords }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener"
      data-design-preview=""
      className={className ?? "flex min-h-10 items-center gap-1.5 border-t border-line px-3 text-sm underline-offset-2 hover:underline"}
    >
      {words.preview}
      <span className="sr-only">
        {" "}
        {title} {words.opensInNewWindow}
      </span>
      <svg viewBox="0 0 24 24" aria-hidden="true" className="size-4" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M14 5h5v5M19 5l-8 8M10 5H5v14h14v-5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </a>
  );
}

/**
 * The choice of theme for a new store (D273), the one choice it starts from, as radio cards: Standard first, then each published theme with
 * its picture, summary and a Preview opening in a new window, and its presets as choices under it (`docs/theme-showcase-phase-1.md` step
 * 4). Each look says which demo store a new store starts with (`demo`); the server works that out again from the look
 * (`contentForLook()`), so nothing else is chosen. Used on `/admin/stores` and `/sign-up`; the form sends `name`: a theme's id,
 * `{id}:{key}` for a preset, or "" for Standard. *Start with this theme* chooses one from the address (`ThemeFromAddress`). Plain markup:
 * it works without JavaScript.
 */
export function DesignCards({
  cards,
  name = "design",
  selected = "",
  legend = "Theme",
  hint,
  startsWith = true,
  words = platformEn.themeCards,
}: {
  cards: DesignCard[];
  name?: string;
  selected?: string;
  legend?: string;
  hint?: string;
  /** Whether each look says what a new store starts with; off where the content is chosen apart (a demo store, D277). */
  startsWith?: boolean;
  words?: DesignCardWords;
}) {
  // A theme's own look (`{id}`) or one of its presets (`{id}:{key}`, `docs/theme-showcase-phase-1.md` step 4).
  const values = cards.flatMap((card) => [card.id, ...(card.looks ?? []).map((look) => designLookValue(card.id, look.key))]);
  const chosen = values.includes(selected) ? selected : "";
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="text-sm font-medium">{legend}</legend>
      {hint && <p className="text-sm text-muted">{hint}</p>}
      <ul className="grid gap-3 sm:grid-cols-2">
        {cards.map((card) => {
          const inputId = `${name}-${card.id || "keep"}`;
          return (
            <li
              key={card.id || "keep"}
              className="flex flex-col overflow-hidden rounded-panel border border-line bg-card has-[:checked]:border-brand has-[:checked]:ring-1 has-[:checked]:ring-ink"
            >
              <label htmlFor={inputId} className="flex flex-1 cursor-pointer flex-col gap-2 p-3 text-sm">
                {card.pictureUrl && (
                  // eslint-disable-next-line @next/next/no-img-element -- a profile's picture from Kaizen's media library
                  <img src={card.pictureUrl} alt="" loading="lazy" className="aspect-video w-full rounded-md border border-line object-cover" />
                )}
                <span className="flex items-start gap-2">
                  <input
                    id={inputId}
                    type="radio"
                    name={name}
                    value={card.id}
                    defaultChecked={card.id === chosen}
                    data-starter={card.starterId ?? undefined}
                    className="mt-1"
                  />
                  <span className="flex min-w-0 flex-col gap-0.5">
                    <span className="font-medium">{card.title}</span>
                    {card.summary && <span className="font-normal">{card.summary}</span>}
                    {card.prices && card.prices.length > 0 && <PremiumNote text={pricesText(card.prices)} words={words} />}
                    {card.id && startsWith && <StartsWith demo={card.demo ?? null} words={words} />}
                  </span>
                </span>
              </label>
              {card.looks && card.looks.length > 0 && (
                <fieldset className="flex flex-col gap-1 px-3 pb-3 text-sm">
                  <legend className="mb-1 text-muted">{words.orPreset}</legend>
                  {card.looks.map((look) => {
                    const value = designLookValue(card.id, look.key);
                    return (
                      // Each at least 32 px high, so the radios are far enough apart to press (WCAG 2.5.8).
                      <span key={look.key} className="flex min-h-8 flex-wrap items-center gap-x-2">
                        <label className="flex min-h-8 cursor-pointer items-center gap-2">
                          <input type="radio" name={name} value={value} defaultChecked={value === chosen} data-starter={look.starterId ?? undefined} />
                          <span className="flex flex-col">
                            <span>
                              {look.name}
                              {look.trade && <span className="text-muted"> · {look.trade}</span>}
                            </span>
                            {startsWith && <StartsWith demo={look.demo ?? null} words={words} />}
                          </span>
                        </label>
                        <DesignPreviewLink
                          href={look.previewHref}
                          title={`${card.title} · ${look.name}`}
                          className="text-muted underline-offset-2 hover:underline"
                          words={words}
                        />
                      </span>
                    );
                  })}
                </fieldset>
              )}
              {card.description && (
                <details className="px-3 pb-3 text-sm">
                  <summary className="cursor-pointer text-muted">
                    {words.moreAbout}<span className="sr-only"> ({card.title})</span>
                  </summary>
                  <p className="mt-1 whitespace-pre-line">{card.description}</p>
                </details>
              )}
              {card.previewHref && <DesignPreviewLink href={card.previewHref} title={card.title} words={words} />}
            </li>
          );
        })}
      </ul>
    </fieldset>
  );
}

/** A premium theme's price on its card (D286): what a store pays once, and that nothing is paid before the store opens. */
function PremiumNote({ text, words }: { text: string; words: DesignCardWords }) {
  return (
    <span className="text-caption" data-theme-price="">
      <span className="font-medium">{words.premium}</span> {words.premiumNote(text)}
    </span>
  );
}

/** What a look starts a new store with (D273): its demo store, which the owner removes in one press from Home, or the Standard store's. */
function StartsWith({ demo, words }: { demo: string | null; words: DesignCardWords }) {
  return <span className="text-caption text-muted">{demo ? words.startsWithDemo(demo) : words.startsWithStandard}</span>;
}
