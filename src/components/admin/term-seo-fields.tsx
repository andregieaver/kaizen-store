"use client";

import { useState } from "react";

import { SearchSnippetFields } from "@/components/admin/seo-fields";
import { DESCRIPTION_MAX, TITLE_MAX } from "@/lib/seo";
import { hasTermSeo, type TermSeo } from "@/lib/term-seo";

/**
 * What a categories-and-tags screen needs to edit a term's search texts (wave 2, second run, D168, `docs/wave-2-redirects.md` 2.4): the store's languages, main
 * first, and how each is named; the store's name and its own description in each language (what a page without a text of its own uses); and the base of the
 * store's addresses for the preview. Plain data: it comes from the server page.
 */
export type TermSeoSetup = {
  locales: string[];
  languageNames: Record<string, string>;
  storeName: string;
  /** The store's own description by language, which a category page without a text of its own uses. */
  descriptions: Record<string, string>;
  /** The address of the store's first market, without a trailing slash: the preview is `{base}/category/{slug}`. */
  base: string;
};

const EMPTY = { title: "", description: "" };

/**
 * A category's or tag's own title and description in search results and shares, one language at a time (2.4): the same two fields and preview as a product's
 * (`SearchSnippetFields`: the 60 and 160 character advice, the 120 and 320 limits). Empty means the page uses the name (and the store's description), as it did
 * before; a language with no text of its own never gets another language's. The words are the owner's own: nothing is written by a model here. Controlled by the
 * term's draft.
 */
export function TermSeoFields({ setup, name, kind, slug, value, onChange }: { setup: TermSeoSetup; name: string; kind: "category" | "tag"; slug: string; value: TermSeo; onChange: (value: TermSeo) => void }) {
  const [locale, setLocale] = useState(setup.locales[0] ?? "");
  const current = value[locale] ?? EMPTY;
  const set = (next: { title: string; description: string }) => onChange({ ...value, [locale]: { title: next.title.slice(0, TITLE_MAX), description: next.description.slice(0, DESCRIPTION_MAX) } });
  const filled = (l: string) => Boolean(value[l] && (value[l].title || value[l].description));
  return (
    <fieldset className="flex flex-col gap-3 rounded-md border border-border bg-background p-3">
      <legend className="px-1 text-xs font-medium">Search results</legend>
      <p className="text-xs text-muted">
        Optional. A language without a text uses the name{setup.storeName ? ` and the store's own description` : ""}. A text is used only in its own language, never in another.
      </p>
      {setup.locales.length > 1 && (
        <div role="group" aria-label="Language of the search text" className="flex flex-wrap gap-1">
          {setup.locales.map((l) => (
            <button
              key={l}
              type="button"
              aria-pressed={l === locale}
              onClick={() => setLocale(l)}
              className="min-h-9 rounded-md border border-border px-3 text-sm aria-pressed:border-foreground aria-pressed:bg-surface aria-pressed:font-medium"
            >
              {setup.languageNames[l] ?? l}
              {filled(l) ? <span className="sr-only"> (has a text)</span> : null}
              {filled(l) ? <span aria-hidden="true"> ·</span> : null}
            </button>
          ))}
        </div>
      )}
      <SearchSnippetFields
        value={current}
        onChange={set}
        fallback={{ title: `${name} · ${setup.storeName}`, description: setup.descriptions[locale] ?? "" }}
        url={`${setup.base}/${kind}/${slug}`}
        lang={locale}
      />
    </fieldset>
  );
}

/** The languages a term has a search text in, as the language names, for the list's one-line mark; empty when it has none. */
export function seoLanguagesOf(seo: TermSeo | undefined, setup: Pick<TermSeoSetup, "locales" | "languageNames">): string[] {
  if (!hasTermSeo(seo)) return [];
  return setup.locales.filter((l) => seo?.[l] && (seo[l].title || seo[l].description)).map((l) => setup.languageNames[l] ?? l);
}
