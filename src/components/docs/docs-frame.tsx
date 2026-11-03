import { fillWords } from "@/lib/admin-fill";
import { DOCS_CHANGELOG_PATH, docRefChildren, docsReferencePath, docsTree, type DocHeading, type DocLang, type DocsIndex, type DocTrack } from "@/lib/docs-content";
import { docsPath, docsSiteHref } from "@/lib/docs-host";
import { DOCS_GUIDE_READY, DOCS_SEARCH_SUB } from "@/lib/docs-search";
import { PLATFORM_LANG_FACTS } from "@/lib/platform-lang";
import type { PlatformMessages } from "@/lib/platform-text";

import { DocsSearch } from "./docs-search";
import type { DocsSearchNames } from "./docs-search-panel";
import { DocsTreeToggle } from "./docs-tree-toggle";

export type DocsWords = PlatformMessages["docs"];

const NAV_LINK = "flex min-h-10 items-center rounded-full px-3 hover:bg-surface aria-[current]:bg-surface aria-[current]:font-semibold";

/** A page's address in the other languages it is written in, for the language switch: none for a page in one language. */
export type DocsLanguages = { lang: DocLang; href: string }[];

/** The names the search shows its tracks and languages by (D443). */
export function docsSearchNames(words: DocsWords): DocsSearchNames {
  return {
    tracks: { owners: words.tracks.owners.name, developers: words.tracks.developers.name },
    langs: { en: PLATFORM_LANG_FACTS.en.name, nb: PLATFORM_LANG_FACTS.nb.name },
  };
}

/** Where a page of the docs is, for the top bar: a track, the generated reference (the developers' too), the changelog, or none. */
export type DocsTopPlace = DocTrack | "reference" | "changelog" | null;

/** The top bar (D442): the mark, the two tracks, the API reference, the changelog, the status page, the search and the language. */
export function DocsTopBar({ lang, track, words, languages }: { lang: DocLang; track: DocsTopPlace; words: DocsWords; languages: DocsLanguages }) {
  const items: { key: string; href: string; label: string; current: boolean }[] = [
    { key: "owners", href: docsPath("owners", lang), label: words.tracks.owners.name, current: track === "owners" },
    { key: "developers", href: docsPath("developers"), label: words.tracks.developers.name, current: track === "developers" },
    { key: "reference", href: docsPath(docsReferencePath()), label: words.apiReference, current: track === "reference" },
    { key: "changelog", href: docsPath(DOCS_CHANGELOG_PATH), label: words.changelog, current: track === "changelog" },
    { key: "status", href: docsSiteHref("/status"), label: words.status, current: false },
  ];
  return (
    <header className="border-b border-border print:border-0">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
        <a href={docsPath("", lang)} className="flex min-h-11 items-center gap-2 text-lg font-semibold">
          <span>Kaizena Flow</span>
          <span className="font-normal text-muted">{words.name}</span>
        </a>
        <nav aria-label={words.topNav} className="order-last -mx-3 w-full overflow-x-auto md:order-none md:mx-0 md:w-auto print:hidden">
          <ul className="flex gap-1 text-sm whitespace-nowrap">
            {items.map((item) => (
              <li key={item.key}>
                <a href={item.href} className={NAV_LINK} aria-current={item.current ? "true" : undefined}>
                  {item.label}
                </a>
              </li>
            ))}
          </ul>
        </nav>
        <div className="ml-auto flex items-center gap-2">
          <DocsSearch
            label={words.search}
            lang={lang}
            track={track === "changelog" || track === "reference" ? "developers" : track}
            words={words.finder}
            names={docsSearchNames(words)}
            searchHref={docsPath(DOCS_SEARCH_SUB, lang)}
            homeHref={docsPath("", lang)}
            guide={DOCS_GUIDE_READY}
          />
          {languages.length > 1 && <DocsLanguageSwitch lang={lang} languages={languages} label={words.language} />}
        </div>
      </div>
    </header>
  );
}

/** The page in its other language (D312's `/no/`): plain links, each in its own language. */
function DocsLanguageSwitch({ lang, languages, label }: { lang: DocLang; languages: DocsLanguages; label: string }) {
  return (
    <nav aria-label={label} className="print:hidden">
      <ul className="flex gap-1 text-sm">
        {languages.map((entry) => (
          <li key={entry.lang}>
            {entry.lang === lang ? (
              <span aria-current="true" className="flex min-h-10 items-center rounded-full bg-surface px-3 font-semibold" lang={PLATFORM_LANG_FACTS[entry.lang].tag}>
                {PLATFORM_LANG_FACTS[entry.lang].name}
              </span>
            ) : (
              <a href={entry.href} hrefLang={PLATFORM_LANG_FACTS[entry.lang].tag} lang={PLATFORM_LANG_FACTS[entry.lang].tag} className={NAV_LINK}>
                {PLATFORM_LANG_FACTS[entry.lang].name}
              </a>
            )}
          </li>
        ))}
      </ul>
    </nav>
  );
}

/** The track's tree (D442): its sections and their pages, the one being read marked, folded under a button on a phone. */
export function DocsTree({ index, track, lang, current, words }: { index: DocsIndex; track: DocTrack; lang: DocLang; current: string; words: DocsWords }) {
  const name = words.tracks[track].name;
  const link = "flex min-h-8 items-center rounded-md px-2 py-1 hover:bg-surface aria-[current=page]:bg-surface aria-[current=page]:font-semibold";
  return (
    <DocsTreeToggle id="docs-tree" label={words.showPages}>
      <nav aria-label={fillWords(words.pagesOf, { track: name })} className="mt-3 text-sm md:mt-0">
        <a href={docsPath(track, lang)} className={`${link} font-semibold`} aria-current={current === track ? "page" : undefined}>
          {name}
        </a>
        <ul className="mt-2 flex flex-col gap-3">
          {docsTree(index, track, lang).map(({ section, pages }) => {
            const path = `${track}/${section.slug}`;
            return (
              <li key={section.slug}>
                <a href={docsPath(path, lang)} className={`${link} font-medium`} aria-current={current === path ? "page" : undefined}>
                  {section.title}
                </a>
                <ul className="ml-2 border-l border-border pl-2">
                  {pages.map((page) => (
                    <li key={page.path}>
                      <a href={docsPath(page.path, lang)} className={link} aria-current={current === page.path ? "page" : undefined}>
                        {page.title}
                      </a>
                    </li>
                  ))}
                </ul>
              </li>
            );
          })}
          {track === "developers" && <DocsReferenceTree index={index} current={current} link={link} words={words} />}
          {track === "developers" && index.changelog && (
            <li>
              <a href={docsPath(DOCS_CHANGELOG_PATH)} className={`${link} font-medium`} aria-current={current === DOCS_CHANGELOG_PATH ? "page" : undefined}>
                {words.changelog}
              </a>
            </li>
          )}
        </ul>
      </nav>
    </DocsTreeToggle>
  );
}

/**
 * The generated reference in the developers' tree (E4): its front page, its groups (Admin API, Webhooks, MCP, …), and the pages of the group
 * being read, so the tree stays short however many resources, topics and areas the contracts hold.
 */
function DocsReferenceTree({ index, current, link, words }: { index: DocsIndex; current: string; link: string; words: DocsWords }) {
  const front = index.reference.pages.find((p) => p.parent === null);
  if (!front) return null;
  const within = (path: string) => current === path || current.startsWith(`${path}/`);
  return (
    <li>
      <a href={docsPath(front.path)} className={`${link} font-medium`} aria-current={current === front.path ? "page" : undefined}>
        {words.apiReference}
      </a>
      <ul className="ml-2 border-l border-border pl-2">
        {docRefChildren(index, front.path).map((group) => {
          const pages = within(group.path) ? docRefChildren(index, group.path) : [];
          return (
            <li key={group.path}>
              <a href={docsPath(group.path)} className={link} aria-current={current === group.path ? "page" : undefined}>
                {group.title}
              </a>
              {pages.length > 0 && (
                <ul className="ml-2 border-l border-border pl-2">
                  {pages.map((page) => (
                    <li key={page.path}>
                      <a href={docsPath(page.path)} className={link} aria-current={current === page.path ? "page" : undefined}>
                        {page.title}
                      </a>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          );
        })}
      </ul>
    </li>
  );
}

/** *On this page*: the page's h2s and h3s (h2s alone where `depth` is 2, as on a long page of operations), linked to their ids. */
export function DocsToc({ headings, words, depth = 3 }: { headings: readonly DocHeading[]; words: DocsWords; depth?: 2 | 3 }) {
  const items = headings.filter((heading) => heading.depth === 2 || (depth === 3 && heading.depth === 3));
  if (items.length === 0) return null;
  return (
    <nav aria-label={words.onThisPage} className="text-sm">
      <p className="font-semibold">{words.onThisPage}</p>
      <ul className="mt-2 flex flex-col">
        {items.map((heading) => (
          <li key={heading.id} className={heading.depth === 3 ? "pl-3" : undefined}>
            <a href={`#${heading.id}`} className="flex min-h-8 items-center text-muted hover:text-foreground hover:underline">
              {heading.text}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}

export type DocsCrumb = { label: string; href: string | null };

/** Where the page is: the docs, its track, its section; the page itself last, not a link. */
export function DocsBreadcrumbs({ trail, words }: { trail: readonly DocsCrumb[]; words: DocsWords }) {
  return (
    <nav aria-label={words.breadcrumb} className="text-sm text-muted print:hidden">
      <ol className="flex flex-wrap items-center gap-x-1">
        {trail.map((crumb, i) => (
          <li key={i} className="flex items-center gap-x-1">
            {i > 0 && <span aria-hidden="true">/</span>}
            {crumb.href ? (
              <a href={crumb.href} className="inline-flex min-h-6 items-center hover:text-foreground hover:underline">
                {crumb.label}
              </a>
            ) : (
              <span aria-current="page" className="text-foreground">
                {crumb.label}
              </span>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}

/** A page the pager leads to: an article or a page of the reference. */
type DocsPagerPage = { path: string; lang: DocLang; title: string };

/** The pages before and after this one in the track's reading order (the reference's own, on its pages). */
export function DocsPager({ previous, next, words }: { previous: DocsPagerPage | null; next: DocsPagerPage | null; words: DocsWords }) {
  if (!previous && !next) return null;
  const card = "flex min-h-11 flex-col rounded-lg border border-border p-4 hover:bg-surface";
  return (
    <nav aria-label={words.pager} className="mt-10 grid gap-3 sm:grid-cols-2 print:hidden">
      {previous && (
        <a href={docsPath(previous.path, previous.lang)} rel="prev" className={card}>
          <span className="text-sm text-muted">{words.previous}</span>
          <span className="font-medium">{previous.title}</span>
        </a>
      )}
      {next && (
        <a href={docsPath(next.path, next.lang)} rel="next" className={`${card} text-right sm:col-start-2`}>
          <span className="text-sm text-muted">{words.next}</span>
          <span className="font-medium">{next.title}</span>
        </a>
      )}
    </nav>
  );
}

/** The docs' frame: the skip link, the top bar, the tree, the page and *On this page*, and a slim footer. */
export function DocsShell({
  words,
  top,
  tree,
  toc,
  children,
}: {
  words: DocsWords;
  top: React.ReactNode;
  tree?: React.ReactNode;
  toc?: React.ReactNode;
  children: React.ReactNode;
}) {
  const columns = tree ? (toc ? "md:grid-cols-[15rem_minmax(0,1fr)] xl:grid-cols-[15rem_minmax(0,1fr)_13rem]" : "md:grid-cols-[15rem_minmax(0,1fr)]") : "";
  return (
    <>
      <a href="#docs-main" className="sr-only focus:not-sr-only focus:absolute focus:m-2 focus:rounded focus:bg-background focus:p-2">
        {words.skip}
      </a>
      {top}
      <div className={`mx-auto grid max-w-7xl gap-x-10 gap-y-4 px-4 py-6 ${columns} print:block`}>
        {tree && <div className="md:sticky md:top-4 md:max-h-[calc(100dvh-2rem)] md:self-start md:overflow-y-auto print:hidden">{tree}</div>}
        <main id="docs-main" tabIndex={-1} className="min-w-0 focus:outline-none">
          {children}
        </main>
        {toc && (
          <div className="hidden xl:block print:hidden">
            <div className="sticky top-4">{toc}</div>
          </div>
        )}
      </div>
      <footer className="border-t border-border print:hidden">
        <div className="mx-auto flex max-w-7xl flex-wrap gap-x-6 gap-y-2 px-4 py-6 text-sm text-muted">
          <a href={docsSiteHref("/")} className="inline-flex min-h-6 items-center hover:text-foreground hover:underline">
            Kaizena Flow
          </a>
          <a href={docsSiteHref("/status")} className="inline-flex min-h-6 items-center hover:text-foreground hover:underline">
            {words.status}
          </a>
        </div>
      </footer>
    </>
  );
}
