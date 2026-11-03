import type { Metadata } from "next";
import { headers } from "next/headers";

import { docSection, isDocTrack, type DocLang } from "@/lib/docs-content";
import { docsPath, docsUrl } from "@/lib/docs-host";
import { DOCS_GUIDE_READY, DOCS_SEARCH_SUB, docsSearchQueryString, hasFilters, type DocsSearchAnswer } from "@/lib/docs-search";
import { readDocsSearchPage } from "@/lib/docs-search-rules";
import { platformText } from "@/lib/platform-text";
import { docsIndex } from "@/server/docs";
import { countDocsMiss, searchDocs } from "@/server/docs-search";
import { log } from "@/server/log";
import { budgetVisitor, takeBudget } from "@/server/request-budget";

import { DocsBreadcrumbs, DocsShell, DocsTopBar, docsSearchNames } from "./docs-frame";
import { DocsSearchPanel, type DocsPanelStart } from "./docs-search-panel";

type Query = Record<string, string | string[] | undefined>;

/** The search page's metadata: its own title, never indexed (a search is for readers; its results are the articles, which are). */
export function docsSearchMetadata(lang: DocLang): Metadata {
  const words = platformText(lang).docs;
  return { title: words.finder.title, robots: { index: false, follow: false }, alternates: { canonical: docsUrl(DOCS_SEARCH_SUB, lang) } };
}

/**
 * The docs' search page (wave 14 unit E3, D443): `/docs/search?q=&track=&kind=&area=&lang=&section=&sort=&cursor=` (`/search` on the docs'
 * host, `/no/…` in Norwegian), drawn on the server at each request with the search already done, so it works without JavaScript (the form
 * submits here, every chip, order and *Show more* is a link here) and an address shares a search; with JavaScript the same panel searches in
 * place. It searches within the `docs_search` budget, as the API does, and counts a search that found nothing in the docs at all for the gap
 * list (a reader's same search once an hour). A section's list of pages leads here with its section as a filter.
 */
export async function DocsSearchRoute({ lang, query }: { lang: DocLang; query: Query }) {
  const index = docsIndex();
  const words = platformText(lang).docs;
  // A cursor that is not one is the first page.
  const asked = readDocsSearchPage(query);
  const wanted = asked.q !== "" || hasFilters(asked.filters);

  let answer: DocsSearchAnswer | null = null;
  let problem: DocsPanelStart["problem"] = null;
  let missCounted = false;
  if (wanted) {
    const visitor = budgetVisitor(await headers());
    if (!(await takeBudget(null, "docs_search", visitor))) {
      problem = "busy";
    } else {
      try {
        const result = await searchDocs(asked);
        const done = result.ok ? result : await searchDocs({ ...asked, cursor: null });
        answer = done.ok ? done.answer : null;
        if (answer && answer.found === 0 && asked.q !== "" && !asked.cursor) {
          missCounted = true;
          await countDocsMiss(asked.q, lang, visitor).catch((error: unknown) => log("warn", "docs_search.miss_failed", {}, error));
        }
      } catch (error) {
        log("error", "docs_search.page_failed", { words: asked.q !== "" }, error);
        problem = "failed";
      }
    }
  }

  const [track, slug] = asked.filters.section?.split("/") ?? [];
  const sectionTitle = track && slug && isDocTrack(track) ? (docSection(index, track, slug, lang)?.title ?? docSection(index, track, slug, "en")?.title ?? null) : null;
  const queryString = docsSearchQueryString({ q: asked.q, filters: asked.filters, sort: asked.sort });
  const languages = (["en", "nb"] as const).map((l) => ({ lang: l, href: `${docsPath(DOCS_SEARCH_SUB, l)}${queryString}` }));

  return (
    <DocsShell words={words} top={<DocsTopBar lang={lang} track={null} words={words} languages={languages} />}>
      <DocsBreadcrumbs trail={[{ label: words.name, href: docsPath("", lang) }, { label: words.finder.title, href: null }]} words={words} />
      <h1 className="mt-4 text-3xl font-semibold tracking-tight md:text-4xl">{sectionTitle ?? words.finder.title}</h1>
      <div className="mt-6 max-w-3xl">
        <DocsSearchPanel
          mode="page"
          start={{ query: { q: asked.q, filters: asked.filters, sort: asked.sort }, answer, problem, missCounted }}
          words={words.finder}
          names={docsSearchNames(words)}
          uiLang={lang}
          searchHref={docsPath(DOCS_SEARCH_SUB, lang)}
          homeHref={docsPath("", lang)}
          guide={DOCS_GUIDE_READY}
          sectionTitle={sectionTitle}
        />
      </div>
    </DocsShell>
  );
}
