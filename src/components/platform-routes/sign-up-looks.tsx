import { DesignPreviewLink, type DesignCardWords } from "@/components/admin/design-cards";
import { designLookValue, type DesignCard } from "@/lib/design-presets";
import { pricesText } from "@/lib/theme-prices";

/**
 * Sign-up's choice of look (D456; the choice itself is D273's): one card per look, its picture, name and a line, the chosen one ringed and
 * ticked. What only matters once a look is chosen (the demo store it starts with, a premium theme's price, the theme's variants) opens
 * under the chosen card alone, so the list stays a page of pictures. The form sends what `DesignCards` sends (`name`: a theme's id,
 * `{id}:{key}` for a preset, "" for Standard), so the server reads it as before; plain markup, chosen with or without scripts (the open
 * card is CSS's `:has(:checked)`). Each radio carries its name and preview (`data-label`, `data-preview`) for the steps' summary and for
 * the card's Preview link, which follows a chosen variant where scripts run (`SignUpWizard`).
 */
export function SignUpLooks({
  cards,
  name = "design",
  selected = "",
  legend,
  words,
}: {
  cards: DesignCard[];
  name?: string;
  selected?: string;
  legend: string;
  words: DesignCardWords;
}) {
  const values = cards.flatMap((card) => [card.id, ...(card.looks ?? []).map((look) => designLookValue(card.id, look.key))]);
  const chosen = values.includes(selected) ? selected : "";
  return (
    <fieldset>
      <legend className="sr-only">{legend}</legend>
      <ul className="grid gap-4 sm:grid-cols-2">
        {cards.map((card) => {
          const inputId = `${name}-${card.id || "standard"}`;
          const premium = card.prices && card.prices.length > 0 ? pricesText(card.prices) : null;
          return (
            <li
              key={card.id || "standard"}
              data-look-card=""
              className="group/look flex flex-col overflow-hidden rounded-xl border border-border bg-background transition-shadow hover:shadow-md has-[:checked]:border-foreground has-[:checked]:shadow-md has-[:checked]:ring-1 has-[:checked]:ring-foreground"
            >
              {/* A row on phones (the picture beside the name, so the list stays short), a picture over the name from tablets up. */}
              <label
                htmlFor={inputId}
                className="relative grid cursor-pointer grid-cols-[7.5rem_minmax(0,1fr)] has-[:focus-visible]:outline-2 has-[:focus-visible]:-outline-offset-4 has-[:focus-visible]:outline-foreground sm:flex sm:flex-col"
              >
                <LookPicture card={card} />
                {/* The card's own look: the dot is the tick in the corner, the radio itself is read and pressed through the card. */}
                <input
                  id={inputId}
                  type="radio"
                  name={name}
                  value={card.id}
                  defaultChecked={card.id === chosen}
                  data-own=""
                  data-label={card.title}
                  data-preview={card.previewHref ?? undefined}
                  data-starter={card.starterId ?? undefined}
                  className="sr-only"
                />
                <Tick />
                {premium && (
                  <span className="absolute top-2 left-2 rounded-full bg-background/95 px-2 py-0.5 text-xs font-medium shadow-sm sm:top-3 sm:left-3 sm:px-2.5">
                    {words.premium.replace(/:$/, "")}
                  </span>
                )}
                <span className="flex flex-col gap-1 py-3 pr-12 pl-4 sm:pt-3 sm:pr-4 sm:pb-4">
                  <span className="font-semibold">{card.title}</span>
                  {card.summary && <span className="text-sm text-muted">{card.summary}</span>}
                </span>
              </label>
              {/* What only the chosen card needs, shown under it alone. */}
              <div className="hidden flex-col gap-3 border-t border-border px-4 pt-3 pb-4 text-sm group-has-[:checked]/look:flex sm:border-t-0 sm:pt-0">
                {card.looks && card.looks.length > 0 && (
                  <fieldset className="flex flex-col gap-2">
                    <legend className="mb-2 text-xs font-medium text-muted">{words.variants}</legend>
                    <span className="flex flex-wrap gap-2">
                      {/* The theme's own look, a second label of the card's radio: for the pointer, as the keys reach that radio first. */}
                      <label htmlFor={inputId} aria-hidden="true" className={`${CHIP} group-has-[[data-own]:checked]/look:border-foreground group-has-[[data-own]:checked]/look:bg-foreground group-has-[[data-own]:checked]/look:text-background`}>
                        {card.title}
                      </label>
                      {card.looks.map((look) => {
                        const value = designLookValue(card.id, look.key);
                        return (
                          <label
                            key={look.key}
                            className={`${CHIP} has-[:checked]:border-foreground has-[:checked]:bg-foreground has-[:checked]:text-background has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-foreground`}
                          >
                            <input
                              type="radio"
                              name={name}
                              value={value}
                              defaultChecked={value === chosen}
                              data-label={`${card.title} · ${look.name}`}
                              data-preview={look.previewHref}
                              data-starter={look.starterId ?? undefined}
                              className="sr-only"
                            />
                            {look.name}
                          </label>
                        );
                      })}
                    </span>
                  </fieldset>
                )}
                {premium && (
                  <p className="text-caption" data-theme-price="">
                    <span className="font-medium">{words.premium}</span> {words.premiumNote(premium)}
                  </p>
                )}
                <p className="text-caption text-muted">{card.id && card.demo ? words.startsWithDemo(card.demo) : words.startsWithStandard}</p>
              </div>
              {card.previewHref && (
                <DesignPreviewLink
                  href={card.previewHref}
                  title={card.title}
                  words={words}
                  className="mt-auto flex min-h-11 items-center gap-1.5 border-t border-border px-4 text-sm font-medium underline-offset-4 hover:underline"
                />
              )}
            </li>
          );
        })}
      </ul>
    </fieldset>
  );
}

const CHIP =
  "flex min-h-9 cursor-pointer items-center rounded-full border border-border px-3.5 text-sm transition-colors hover:border-foreground";

/** A look's picture, or for Standard a drawing of a plain store: a bar, a band and three products. */
function LookPicture({ card }: { card: DesignCard }) {
  if (card.pictureUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- a theme's picture from Kaizena Flow's media library
      <img
        src={card.pictureUrl}
        alt=""
        loading="lazy"
        className="h-full min-h-24 w-full border-r border-border object-cover object-top sm:aspect-video sm:h-auto sm:min-h-0 sm:border-r-0 sm:border-b"
      />
    );
  }
  return (
    <span
      aria-hidden="true"
      className="flex h-full min-h-24 w-full items-center justify-center border-r border-border bg-surface text-muted sm:aspect-video sm:h-auto sm:min-h-0 sm:border-r-0 sm:border-b"
    >
      <svg viewBox="0 0 160 90" className="h-4/5" fill="currentColor">
        <rect x="14" y="10" width="132" height="8" rx="2" opacity="0.35" />
        <rect x="14" y="24" width="132" height="22" rx="3" opacity="0.2" />
        <rect x="14" y="52" width="40" height="28" rx="3" opacity="0.3" />
        <rect x="60" y="52" width="40" height="28" rx="3" opacity="0.3" />
        <rect x="106" y="52" width="40" height="28" rx="3" opacity="0.3" />
      </svg>
    </span>
  );
}

/** The corner tick: an empty ring, filled and ticked on the chosen card. */
function Tick() {
  return (
    <span
      aria-hidden="true"
      className="absolute top-3 right-3 flex size-7 items-center justify-center rounded-full border-2 border-border bg-background/95 text-transparent shadow-sm group-has-[:checked]/look:border-foreground group-has-[:checked]/look:bg-foreground group-has-[:checked]/look:text-background"
    >
      <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="3">
        <path d="M5 12.5l4.5 4.5L19 7.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </span>
  );
}
