import type { DesignCard } from "@/lib/design-presets";

import { DesignChoiceSync } from "./design-choice-sync";

/** The Preview link of a design profile: a new window, without giving it this page. */
export function DesignPreviewLink({ href, title, className }: { href: string; title: string; className?: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener"
      data-design-preview=""
      className={className ?? "flex min-h-10 items-center gap-1.5 border-t border-border px-3 text-sm underline-offset-2 hover:underline"}
    >
      Preview
      <span className="sr-only">
        {" "}
        {title} (opens in a new window)
      </span>
      <svg viewBox="0 0 24 24" aria-hidden="true" className="size-4" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M14 5h5v5M19 5l-8 8M10 5H5v14h14v-5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </a>
  );
}

/**
 * The choice of design profile (D176) for a new store, as radio cards after the store template's: "Keep the template's own design" first,
 * then each published profile with its picture, summary and a Preview opening in a new window. Used on `/admin/stores` and `/sign-up`;
 * the form sends `name`, a profile's id or "" to keep the template's look, and the server checks it again. With `recommended`, choosing a
 * store template in the same form chooses the profile it recommends (`DesignChoiceSync`). Plain markup otherwise: it works without
 * JavaScript.
 */
export function DesignCards({
  cards,
  name = "design",
  selected = "",
  legend = "Design profile",
  hint,
  recommended,
}: {
  cards: DesignCard[];
  name?: string;
  selected?: string;
  legend?: string;
  hint?: string;
  recommended?: Record<string, string>;
}) {
  const chosen = cards.some((card) => card.id === selected) ? selected : "";
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="text-sm font-medium">{legend}</legend>
      {hint && <p className="text-sm text-muted">{hint}</p>}
      {recommended && <DesignChoiceSync recommended={recommended} designName={name} />}
      <ul className="grid gap-3 sm:grid-cols-2">
        {cards.map((card) => {
          const inputId = `${name}-${card.id || "keep"}`;
          return (
            <li
              key={card.id || "keep"}
              className="flex flex-col overflow-hidden rounded-lg border border-border bg-background has-[:checked]:border-foreground has-[:checked]:ring-1 has-[:checked]:ring-foreground"
            >
              <label htmlFor={inputId} className="flex flex-1 cursor-pointer flex-col gap-2 p-3 text-sm">
                {card.pictureUrl && (
                  // eslint-disable-next-line @next/next/no-img-element -- a profile's picture from Kaizen's media library
                  <img src={card.pictureUrl} alt="" loading="lazy" className="aspect-video w-full rounded-md border border-border object-cover" />
                )}
                <span className="flex items-start gap-2">
                  <input id={inputId} type="radio" name={name} value={card.id} defaultChecked={card.id === chosen} className="mt-1" />
                  <span className="flex min-w-0 flex-col gap-0.5">
                    <span className="font-medium">{card.title}</span>
                    {card.summary && <span className="font-normal">{card.summary}</span>}
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
              {card.previewHref && <DesignPreviewLink href={card.previewHref} title={card.title} />}
            </li>
          );
        })}
      </ul>
    </fieldset>
  );
}
