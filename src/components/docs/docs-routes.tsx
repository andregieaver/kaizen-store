import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { fillWords } from "@/lib/admin-fill";
import { PAGES_NB } from "@/lib/admin-messages/pages.nb";
import { matchPath } from "@/lib/admin-map";
import {
  DOC_TRACKS,
  DOCS_CHANGELOG_PATH,
  docNeighbours,
  docPage,
  docSection,
  docsPaths,
  docsTree,
  isDocTrack,
  trackIn,
  type DocLang,
  type DocPage,
  type DocsIndex,
  type DocTrack,
} from "@/lib/docs-content";
import { docsMarkdownPath, docsPath, docsUrl } from "@/lib/docs-host";
import { PLATFORM_LANG_FACTS } from "@/lib/platform-lang";
import { platformText } from "@/lib/platform-text";
import { formatDocDate } from "@/lib/docs-text";
import { docsIndex } from "@/server/docs";

import { DocsFeedback } from "./docs-feedback";
import { DocsBreadcrumbs, DocsPager, DocsShell, DocsToc, DocsTopBar, DocsTree, type DocsCrumb, type DocsLanguages, type DocsWords } from "./docs-frame";
import { DocsMarkdown, type DocsMarkdownContext } from "./docs-markdown";
import { DocsReadCount } from "./docs-read-count";
import { DocsSectionFilters } from "./docs-section-filters";

/**
 * The docs' routes (wave 14 unit E1, D442), drawn the same in each language's route group: `(docs)` at `/docs` and `(docs-nb)` at `/no/docs`
 * (the owners' track only), on the docs' own host at `/` and `/no` (`docsHostRoutes()`). Every address is prerendered from the index
 * (`docsStaticParams()`); one not built is a 404.
 */

/** What an address in the docs is: the front page, a track, a section, a page or the changelog. */
type DocsPlace =
  | { kind: "home" }
  | { kind: "track"; track: DocTrack }
  | { kind: "section"; track: DocTrack; slug: string }
  | { kind: "page"; page: DocPage }
  | { kind: "changelog" };

function placeOf(index: DocsIndex, lang: DocLang, segments: readonly string[]): DocsPlace | null {
  const path = segments.join("/");
  if (!docsPaths(index, lang).includes(path)) return null;
  if (path === "") return { kind: "home" };
  if (path === DOCS_CHANGELOG_PATH) return { kind: "changelog" };
  const [track, section] = segments;
  if (!isDocTrack(track)) return null;
  if (segments.length === 1) return { kind: "track", track };
  if (segments.length === 2) return { kind: "section", track, slug: section };
  const page = docPage(index, path, lang);
  return page ? { kind: "page", page } : null;
}

/** Every address under `/docs/…` (or `/no/docs/…`) the build draws: the tracks, the sections, the pages and the changelog. */
export function docsStaticParams(lang: DocLang): { path: string[] }[] {
  return docsPaths(docsIndex(), lang)
    .filter((path) => path !== "")
    .map((path) => ({ path: path.split("/") }));
}

/** The address in each language it is written in, for `hreflang` and the language switch; one language alone has none. */
function languagesOf(index: DocsIndex, path: string): DocsLanguages {
  const langs = (["en", "nb"] as const).filter((lang) => docsPaths(index, lang).includes(path));
  return langs.length > 1 ? langs.map((lang) => ({ lang, href: docsPath(path, lang) })) : [];
}

function alternates(index: DocsIndex, path: string, lang: DocLang, markdown: boolean): Metadata["alternates"] {
  const langs = languagesOf(index, path);
  return {
    canonical: docsUrl(path, lang),
    ...(langs.length > 1 && {
      languages: { ...Object.fromEntries(langs.map((entry) => [PLATFORM_LANG_FACTS[entry.lang].tag, docsUrl(path, entry.lang)])), "x-default": docsUrl(path) },
    }),
    ...(markdown && { types: { "text/markdown": `${docsUrl(path, lang)}.md` } }),
  };
}

export function docsHomeMetadata(lang: DocLang): Metadata {
  const words = platformText(lang).docs;
  return { title: { absolute: words.title }, description: words.description, alternates: alternates(docsIndex(), "", lang, false) };
}

export function docsPageMetadata(lang: DocLang, segments: readonly string[]): Metadata {
  const index = docsIndex();
  const place = placeOf(index, lang, segments);
  if (!place) return {};
  const words = platformText(lang).docs;
  const path = segments.join("/");
  switch (place.kind) {
    case "home":
      return docsHomeMetadata(lang);
    case "changelog":
      return { title: index.changelog?.title ?? words.changelog, description: words.changelogLead, alternates: alternates(index, path, lang, true) };
    case "track":
      return { title: words.tracks[place.track].name, description: words.tracks[place.track].lead, alternates: alternates(index, path, lang, false) };
    case "section": {
      const section = docSection(index, place.track, place.slug, lang);
      return { title: section?.title, description: section?.summary || undefined, alternates: alternates(index, path, lang, false) };
    }
    case "page":
      return {
        title: place.page.title,
        description: place.page.summary,
        alternates: alternates(index, path, lang, true),
        openGraph: { type: "article", title: place.page.title, description: place.page.summary, url: docsUrl(path, lang) },
      };
  }
}

function markdownContext(index: DocsIndex, lang: DocLang, words: DocsWords): DocsMarkdownContext {
  return { index, lang, callouts: words.callouts };
}

const HEADING = "text-3xl font-semibold tracking-tight md:text-4xl";

/** The docs' front page: the two tracks, each with its sections. */
export function DocsHomeRoute({ lang }: { lang: DocLang }) {
  const index = docsIndex();
  const words = platformText(lang).docs;
  return (
    <DocsShell words={words} top={<DocsTopBar lang={lang} track={null} words={words} languages={languagesOf(index, "")} />}>
      <h1 className={HEADING}>{words.title}</h1>
      <p className="mt-3 max-w-2xl text-lg text-muted">{words.homeLead}</p>
      <div className="mt-10 grid gap-6 md:grid-cols-2">
        {DOC_TRACKS.map((track) => {
          // The developers' track is in English alone: from a Norwegian page it is the English one, and says so.
          const trackLang: DocLang = trackIn(track, lang) ? lang : "en";
          return (
            <section key={track} aria-labelledby={`track-${track}`} className="rounded-xl border border-border p-6">
              <h2 id={`track-${track}`} className="text-xl font-semibold">
                <a href={docsPath(track, trackLang)} className="hover:underline">
                  {words.tracks[track].name}
                </a>
                {trackLang !== lang && <span className="ml-2 text-sm font-normal text-muted">({words.englishOnly})</span>}
              </h2>
              <p className="mt-2 text-muted">{words.tracks[track].lead}</p>
              <ul className="mt-4 flex flex-col gap-1">
                {docsTree(index, track, trackLang).map(({ section }) => (
                  <li key={section.slug}>
                    <a href={docsPath(`${track}/${section.slug}`, trackLang)} className="inline-flex min-h-8 items-center underline-offset-2 hover:underline">
                      {section.title}
                    </a>
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
      </div>
    </DocsShell>
  );
}

/** A track, a section, a page or the changelog. */
export function DocsPageRoute({ lang, segments }: { lang: DocLang; segments: readonly string[] }) {
  const index = docsIndex();
  const place = placeOf(index, lang, segments);
  if (!place) notFound();
  const words = platformText(lang).docs;
  const path = segments.join("/");
  const ctx = markdownContext(index, lang, words);
  const top = (track: DocTrack | "changelog") => <DocsTopBar lang={lang} track={track} words={words} languages={languagesOf(index, path)} />;
  const tree = (track: DocTrack) => <DocsTree index={index} track={track} lang={lang} current={path} words={words} />;
  const home: DocsCrumb = { label: words.name, href: docsPath("", lang) };
  const trackCrumb = (track: DocTrack): DocsCrumb => ({ label: words.tracks[track].name, href: docsPath(track, lang) });

  switch (place.kind) {
    case "home":
      return <DocsHomeRoute lang={lang} />;

    case "changelog": {
      const log = index.changelog;
      if (!log) notFound();
      return (
        <DocsShell words={words} top={top("changelog")} tree={tree("developers")} toc={<DocsToc headings={log.headings} words={words} />}>
          <DocsBreadcrumbs trail={[home, trackCrumb("developers"), { label: words.changelog, href: null }]} words={words} />
          <article className="mt-4">
            <h1 className={HEADING}>{log.title ?? words.changelog}</h1>
            <p className="mt-3 text-lg text-muted">{words.changelogLead}</p>
            <div className="mt-8">
              <DocsMarkdown blocks={log.blocks} ctx={ctx} />
            </div>
          </article>
          <MarkdownLink href={docsMarkdownPath(DOCS_CHANGELOG_PATH)} words={words} />
          <DocsReadCount path={DOCS_CHANGELOG_PATH} lang="en" />
        </DocsShell>
      );
    }

    case "track":
      return (
        <DocsShell words={words} top={top(place.track)} tree={tree(place.track)}>
          <DocsBreadcrumbs trail={[home, { label: words.tracks[place.track].name, href: null }]} words={words} />
          <h1 className={`mt-4 ${HEADING}`}>{words.tracks[place.track].name}</h1>
          <p className="mt-3 max-w-2xl text-lg text-muted">{words.tracks[place.track].lead}</p>
          <div className="mt-8 grid gap-6 lg:grid-cols-2">
            {docsTree(index, place.track, lang).map(({ section, pages }) => (
              <section key={section.slug} aria-labelledby={`section-${section.slug}`} className="rounded-xl border border-border p-5">
                <h2 id={`section-${section.slug}`} className="text-lg font-semibold">
                  <a href={docsPath(`${place.track}/${section.slug}`, lang)} className="hover:underline">
                    {section.title}
                  </a>
                </h2>
                {section.summary && <p className="mt-1 text-sm text-muted">{section.summary}</p>}
                <PageList pages={pages} />
              </section>
            ))}
          </div>
        </DocsShell>
      );

    case "section": {
      const section = docSection(index, place.track, place.slug, lang);
      const entry = docsTree(index, place.track, lang).find((e) => e.section.slug === place.slug);
      if (!section || !entry) notFound();
      return (
        <DocsShell words={words} top={top(place.track)} tree={tree(place.track)}>
          <DocsBreadcrumbs trail={[home, trackCrumb(place.track), { label: section.title, href: null }]} words={words} />
          <h1 className={`mt-4 ${HEADING}`}>{section.title}</h1>
          {section.summary && <p className="mt-3 max-w-2xl text-lg text-muted">{section.summary}</p>}
          <PageList pages={entry.pages} />
          <DocsSectionFilters index={index} track={place.track} slug={place.slug} lang={lang} words={words} />
        </DocsShell>
      );
    }

    case "page": {
      const page = place.page;
      const section = docSection(index, page.track, page.section, lang);
      const { previous, next } = docNeighbours(index, page);
      const admin = page.admin ? adminTitle(page.admin, lang) : null;
      return (
        <DocsShell words={words} top={top(page.track)} tree={tree(page.track)} toc={<DocsToc headings={page.headings} words={words} />}>
          <DocsBreadcrumbs
            trail={[home, trackCrumb(page.track), { label: section?.title ?? page.section, href: docsPath(`${page.track}/${page.section}`, lang) }, { label: page.title, href: null }]}
            words={words}
          />
          <article className="mt-4" data-docs-page={page.path}>
            <h1 className={HEADING}>{page.title}</h1>
            <p className="mt-3 text-lg text-muted">{page.summary}</p>
            {admin && (
              <p className="mt-3 text-sm">
                <span className="text-muted">{words.inAdmin}</span> <span className="font-medium">{admin}</span>
              </p>
            )}
            <div className="mt-8">
              <DocsMarkdown blocks={page.blocks} ctx={ctx} />
            </div>
          </article>
          <p className="mt-10 flex flex-wrap gap-x-6 gap-y-2 text-sm text-muted">
            <span>{fillWords(words.checked, { date: formatDocDate(page.checked, PLATFORM_LANG_FACTS[lang].locale) })}</span>
            <a href={docsMarkdownPath(page.path, lang)} className="inline-flex min-h-6 items-center underline underline-offset-2 hover:no-underline print:hidden">
              {words.markdown}
            </a>
          </p>
          <DocsFeedback path={page.path} lang={lang} words={words.feedback} />
          <DocsReadCount path={page.path} lang={lang} />
          <DocsPager previous={previous} next={next} words={words} />
        </DocsShell>
      );
    }
  }
}

function PageList({ pages }: { pages: readonly DocPage[] }) {
  return (
    <ul className="mt-4 flex flex-col gap-3">
      {pages.map((page) => (
        <li key={page.path}>
          <a href={docsPath(page.path, page.lang)} className="inline-flex min-h-8 items-center font-medium underline-offset-2 hover:underline">
            {page.title}
          </a>
          <p className="text-sm text-muted">{page.summary}</p>
        </li>
      ))}
    </ul>
  );
}

function MarkdownLink({ href, words }: { href: string; words: DocsWords }) {
  return (
    <p className="mt-10 text-sm print:hidden">
      <a href={href} className="inline-flex min-h-6 items-center text-muted underline underline-offset-2 hover:no-underline">
        {words.markdown}
      </a>
    </p>
  );
}

/** Where in the admin a page happens, as the admin map names it (in Norwegian where the map has its name). */
function adminTitle(path: string, lang: DocLang): string | null {
  const found = matchPath(path);
  if (!found) return null;
  if (lang === "nb") return PAGES_NB[`${found.page.area}:${found.page.id}`]?.title ?? found.page.title;
  return found.page.title;
}
