import { STARTER_CATEGORY_LABELS, type StarterCard } from "@/lib/store-starters";

/**
 * The choice of store template (D175) for a new store, as radio cards: picture, title, category and summary, each with a Preview link
 * that opens the template's storefront in a new window. Used on `/admin/stores` and `/sign-up`; the form sends `name`, a starter's id
 * or "" for the Standard store, and the server checks it again (`commerce.starter_source()`). Plain markup, no state: it works without
 * JavaScript.
 */
export function StarterCards({
  cards,
  name = "starter",
  selected = "",
  legend = "Start from",
  hint,
}: {
  cards: StarterCard[];
  name?: string;
  selected?: string;
  legend?: string;
  hint?: string;
}) {
  const chosen = cards.some((card) => card.id === selected) ? selected : "";
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="text-sm font-medium">{legend}</legend>
      {hint && <p className="text-sm text-muted">{hint}</p>}
      <ul className="grid gap-3 sm:grid-cols-2">
        {cards.map((card) => {
          const inputId = `${name}-${card.id || "standard"}`;
          return (
            <li
              key={card.id || "standard"}
              className="flex flex-col overflow-hidden rounded-lg border border-border bg-background has-[:checked]:border-foreground has-[:checked]:ring-1 has-[:checked]:ring-foreground"
            >
              <label htmlFor={inputId} className="flex flex-1 cursor-pointer flex-col gap-2 p-3 text-sm">
                {card.pictureUrl && (
                  // eslint-disable-next-line @next/next/no-img-element -- a template's picture from Kaizen's media library
                  <img src={card.pictureUrl} alt="" loading="lazy" className="aspect-video w-full rounded-md border border-border object-cover" />
                )}
                <span className="flex items-start gap-2">
                  <input
                    id={inputId}
                    type="radio"
                    name={name}
                    value={card.id}
                    defaultChecked={card.id === chosen}
                    className="mt-1"
                  />
                  <span className="flex min-w-0 flex-col gap-0.5">
                    <span className="font-medium">{card.title}</span>
                    {card.category && <span className="text-muted">{STARTER_CATEGORY_LABELS[card.category]}</span>}
                    {card.summary && <span className="font-normal">{card.summary}</span>}
                    {card.featureWords && <span className="text-muted">{`Starts with: ${card.featureWords}`}</span>}
                  </span>
                </span>
              </label>
              {card.description && (
                <details className="px-3 pb-3 text-sm">
                  <summary className="cursor-pointer text-muted">
                    More about it<span className="sr-only"> ({card.title})</span>
                  </summary>
                  <p className="mt-1 whitespace-pre-line">{card.description}</p>
                </details>
              )}
              {card.previewHref && (
                <a
                  href={card.previewHref}
                  target="_blank"
                  rel="noopener"
                  className="flex min-h-10 items-center gap-1.5 border-t border-border px-3 text-sm underline-offset-2 hover:underline"
                >
                  Preview
                  <span className="sr-only">
                    {" "}
                    {card.title} (opens in a new window)
                  </span>
                  <svg viewBox="0 0 24 24" aria-hidden="true" className="size-4" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M14 5h5v5M19 5l-8 8M10 5H5v14h14v-5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </a>
              )}
            </li>
          );
        })}
      </ul>
    </fieldset>
  );
}
