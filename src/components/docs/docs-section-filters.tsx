import type { DocLang, DocsIndex, DocTrack } from "@/lib/docs-content";
import { docsPath } from "@/lib/docs-host";
import { docsIndexRows } from "@/lib/docs-index";
import { DOCS_SEARCH_SUB, DOCS_SORTS, docsSearchQueryString, NO_FILTERS, toggleFilter, type DocsFacetName, type DocsFilters, type DocsSort } from "@/lib/docs-search";
import { browseDocs, facetCounts } from "@/lib/docs-search-rules";

import type { DocsWords } from "./docs-frame";

const CHIP = "inline-flex min-h-8 items-center gap-1.5 rounded-full border border-border px-3 hover:bg-surface";

/**
 * A section's pages filtered and ordered as the search filters and orders (D443): the section's kinds and topics with how many of its pages
 * each holds, and the four orders, each a link to the search page with the section as its filter (so a section stays prerendered, and its
 * filtered list is an address to share). Counted at build from the section's own pages, by the search's own rules (`facetCounts()`).
 */
export function DocsSectionFilters({ index, track, slug, lang, words }: { index: DocsIndex; track: DocTrack; slug: string; lang: DocLang; words: DocsWords }) {
  const section = `${track}/${slug}`;
  const filters: DocsFilters = { ...NO_FILTERS, section, lang: [lang] };
  const docs = browseDocs(docsIndexRows(index, []).filter((row) => row.section === section && row.lang === lang));
  const facets = facetCounts(docs, filters);
  const href = (next: DocsFilters, sort: DocsSort) => `${docsPath(DOCS_SEARCH_SUB, lang)}${docsSearchQueryString({ q: "", filters: next, sort })}`;
  const w = words.finder;
  const row = (facet: DocsFacetName) =>
    facets[facet].length > 0 && (
      <li className="flex flex-wrap items-center gap-2">
        <span className="mr-1 text-muted">{w.facets[facet]}</span>
        {facets[facet].map((f) => (
          <a key={f.value} href={href(toggleFilter(filters, facet, f.value), "relevance")} className={CHIP}>
            <span>{facet === "kind" ? w.kinds[f.value as keyof typeof w.kinds] : w.areas[f.value as keyof typeof w.areas]}</span>
            <span className="text-muted">{f.count}</span>
          </a>
        ))}
      </li>
    );
  return (
    <nav aria-label={w.sectionBar} className="mt-10 rounded-lg border border-border p-4 text-sm print:hidden">
      <p className="font-medium">{w.sectionBar}</p>
      <ul className="mt-3 flex flex-col gap-3">
        {row("kind")}
        {row("area")}
        <li className="flex flex-wrap items-center gap-2">
          <span className="mr-1 text-muted">{w.order}</span>
          {DOCS_SORTS.map((sort) => (
            <a key={sort} href={href(filters, sort)} className={CHIP}>
              {sort === "relevance" ? w.sorts.reading : w.sorts[sort]}
            </a>
          ))}
        </li>
      </ul>
    </nav>
  );
}
