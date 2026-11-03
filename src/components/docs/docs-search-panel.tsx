"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";

import { fillWords } from "@/lib/admin-fill";
import type { DocLang, DocTrack } from "@/lib/docs-content";
import {
  DOCS_ASK_EVENT,
  DOCS_DEBOUNCE_MS,
  DOCS_MISS_ENDPOINT,
  DOCS_MISS_SETTLE_MS,
  DOCS_QUERY_MAX,
  DOCS_SEARCH_ENDPOINT,
  DOCS_SORTS,
  docsAskSub,
  docsSearchQueryString,
  hasFilters,
  NO_FILTERS,
  toggleFilter,
  type DocsFacet,
  type DocsFacetName,
  type DocsFilters,
  type DocsSearchAnswer,
  type DocsSearchHit,
  type DocsSort,
} from "@/lib/docs-search";
import type { PlatformMessages } from "@/lib/platform-text";

export type DocsFinderWords = PlatformMessages["docs"]["finder"];

/** What a search asks: its words, filters and order. */
export type DocsSearchState = { q: string; filters: DocsFilters; sort: DocsSort };

/** What the panel starts with: on the search page the server's own answer (or why there is none); in the dialog nothing yet. */
export type DocsPanelStart = { query: DocsSearchState; answer: DocsSearchAnswer | null; problem: "busy" | "failed" | null; missCounted: boolean };

/** The names a result and a filter are shown with that are not the finder's own words. */
export type DocsSearchNames = { tracks: Record<DocTrack, string>; langs: Record<DocLang, string> };

type Status = "idle" | "loading" | "done" | "failed" | "busy";

const CHIP = "inline-flex min-h-8 items-center gap-1.5 rounded-full border px-3 text-sm";

/** Whether a click is a plain one (a new tab or window keeps the link's own address). */
const plainClick = (event: React.MouseEvent) => event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey;

/**
 * The docs' search (wave 14 unit E3, D443), as the dialog and the search page both draw it: a form that searches as the reader types (a
 * pause of `DOCS_DEBOUNCE_MS`), the filters as chips with their counts, the order, and the results, each with its track, kind and breadcrumb.
 * Every chip, order and *Show more* is a link to the search page with that search in its address, so the page works without JavaScript and a
 * search can be shared; with JavaScript a plain click searches in place (and on the page keeps the address in step). The keyboard: ↓ from the
 * field to the results, ↑ and ↓ between them, Enter opens one (in the dialog, Enter in the field opens the first), typing goes back to the
 * field. The count and a search that found nothing are said politely. A search that found nothing in the docs at all, standing for a moment,
 * is counted once for the docs' gap list; the guide is offered with the question filled in once it exists (`guide`).
 */
export function DocsSearchPanel({
  mode,
  start,
  words,
  names,
  uiLang,
  searchHref,
  homeHref,
  guide,
  sectionTitle,
  onAsk,
  onClose,
}: {
  mode: "dialog" | "page";
  start: DocsPanelStart;
  words: DocsFinderWords;
  names: DocsSearchNames;
  uiLang: DocLang;
  /** The search page's address on the host serving the docs (`/docs/search`, `/search`). */
  searchHref: string;
  /** The docs' front page (`/docs`, `/`), which the guide's hand-over adds `?ask=` to. */
  homeHref: string;
  guide: boolean;
  /** The title of the section a list is filtered to, for its chip. */
  sectionTitle: string | null;
  /** In the dialog: hand the question to the guide and close. */
  onAsk?: (question: string) => void;
  /** In the dialog: close it. Escape in a search field with words in it only clears them in Chromium, so the field closes the dialog itself. */
  onClose?: () => void;
}) {
  const [q, setQ] = useState(start.query.q);
  const [filters, setFilters] = useState(start.query.filters);
  const [sort, setSort] = useState(start.query.sort);
  const [answer, setAnswer] = useState<DocsSearchAnswer | null>(start.answer);
  const [results, setResults] = useState<DocsSearchHit[]>(start.answer?.results ?? []);
  const [phase, setStatus] = useState<Status>(start.problem ?? (start.answer ? "done" : "idle"));
  const hiddenChosen = start.query.filters.kind.length + start.query.filters.area.length > 0 || start.query.sort !== "relevance";
  const [moreOpen, setMoreOpen] = useState(hiddenChosen);
  const counted = useRef(new Set<string>(start.missCounted ? [start.query.q.trim().toLowerCase()] : []));
  const controller = useRef<AbortController | null>(null);
  const firstRun = useRef(true);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const ids = { field: useId(), keys: useId(), list: useId(), status: useId(), more: useId() };

  const wants = useCallback((state: DocsSearchState) => state.q.trim() !== "" || (mode === "page" && hasFilters(state.filters)), [mode]);
  // Without anything to search the panel is idle, whatever the last answer was: worked out here, not set in an effect.
  const status: Status = wants({ q, filters, sort }) ? phase : "idle";
  // The answer shown: none while idle, busy or failed.
  const current = status === "done" || status === "loading" ? answer : null;
  const addressOf = useCallback((state: DocsSearchState, cursor: string | null = null) => `${searchHref}${docsSearchQueryString({ ...state, cursor })}`, [searchHref]);

  const run = useCallback(async (state: DocsSearchState, cursor: string | null) => {
    controller.current?.abort();
    const asking = new AbortController();
    controller.current = asking;
    setStatus("loading");
    try {
      const response = await fetch(`${DOCS_SEARCH_ENDPOINT}${docsSearchQueryString({ ...state, cursor })}`, { signal: asking.signal, headers: { Accept: "application/json" } });
      if (response.status === 429) {
        setStatus("busy");
        return;
      }
      if (!response.ok) throw new Error(`search answered ${response.status}`);
      const body = (await response.json()) as DocsSearchAnswer;
      if (asking.signal.aborted) return;
      setAnswer(body);
      setResults((now) => (cursor ? [...now, ...body.results] : body.results));
      setStatus("done");
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      setStatus("failed");
    }
  }, []);

  // Search as the reader types or chooses: after a pause, the last ask only. On the page the address follows, so it can be shared.
  useEffect(() => {
    const state = { q, filters, sort };
    if (firstRun.current) {
      firstRun.current = false;
      if (start.answer || start.problem) return;
    }
    if (mode === "page") window.history.replaceState(window.history.state, "", addressOf(state));
    if (!wants(state)) {
      controller.current?.abort();
      return;
    }
    const timer = window.setTimeout(() => void run(state, null), DOCS_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [q, filters, sort, mode, wants, run, addressOf, start.answer, start.problem]);

  // A search that found nothing in the docs at all, standing a moment, is counted once for the gap list.
  useEffect(() => {
    if (status !== "done" || !answer || answer.found > 0 || answer.q.trim() === "") return;
    const key = answer.q.trim().toLowerCase();
    if (counted.current.has(key)) return;
    const timer = window.setTimeout(() => {
      counted.current.add(key);
      void fetch(DOCS_MISS_ENDPOINT, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ q: answer.q, lang: uiLang }), keepalive: true }).catch(() => {});
    }, DOCS_MISS_SETTLE_MS);
    return () => window.clearTimeout(timer);
  }, [answer, status, uiLang]);

  const state: DocsSearchState = { q, filters, sort };
  const pick = (next: Partial<DocsSearchState>) => (event: React.MouseEvent) => {
    if (!plainClick(event)) return;
    event.preventDefault();
    if (next.filters) setFilters(next.filters);
    if (next.sort) setSort(next.sort);
    if (next.q !== undefined) setQ(next.q);
  };

  const hits = () => [...(list.current?.querySelectorAll<HTMLAnchorElement>("a[data-docs-hit]") ?? [])];
  const onFieldKey = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape" && onClose) {
      event.preventDefault();
      onClose();
      return;
    }
    if (event.key === "ArrowDown") {
      const first = hits()[0];
      if (first) {
        event.preventDefault();
        first.focus();
      }
    }
  };
  const onListKey = (event: React.KeyboardEvent<HTMLUListElement>) => {
    const all = hits();
    const at = all.indexOf(document.activeElement as HTMLAnchorElement);
    if (at < 0) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      all[Math.min(at + 1, all.length - 1)].focus();
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      (at === 0 ? input.current : all[at - 1])?.focus();
    } else if (event.key.length === 1 && !event.metaKey && !event.ctrlKey && !event.altKey) {
      // Typing on a result goes on in the field.
      input.current?.focus();
    }
  };
  const onSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    if (mode === "dialog") {
      // In the dialog Enter opens the first result; with none, the form goes to the search page (its default).
      const first = hits()[0];
      if (first) {
        event.preventDefault();
        first.click();
      }
      return;
    }
    event.preventDefault();
    void run(state, null);
  };

  const label = (facet: DocsFacetName, value: string): string => {
    if (facet === "track") return names.tracks[value as DocTrack] ?? value;
    if (facet === "lang") return names.langs[value as DocLang] ?? value;
    if (facet === "kind") return words.kinds[value as keyof DocsFinderWords["kinds"]] ?? value;
    return words.areas[value as keyof DocsFinderWords["areas"]] ?? value;
  };
  /** A facet's chips: the answer's values with their counts, or, before an answer, the chosen ones alone. */
  const chipsOf = (facet: DocsFacetName): DocsFacet[] =>
    current ? current.facets[facet] : (filters[facet] as string[]).map((value) => ({ value, count: -1, selected: true }));

  const facetRow = (facet: DocsFacetName) => {
    const chips = chipsOf(facet);
    if (chips.length === 0) return null;
    const heading = `${ids.more}-${facet}`;
    return (
      <div role="group" aria-labelledby={heading} className="flex flex-wrap items-center gap-2">
        <span id={heading} className="mr-1 text-sm text-muted">
          {words.facets[facet]}
        </span>
        {chips.map((chip) => {
          const next = toggleFilter(filters, facet, chip.value);
          return (
            <a
              key={chip.value}
              href={addressOf({ ...state, filters: next })}
              onClick={pick({ filters: next })}
              className={`${CHIP} ${chip.selected ? "border-foreground bg-foreground text-background" : "border-border hover:bg-surface"}`}
            >
              {chip.selected && <span aria-hidden="true">✓</span>}
              <span>{label(facet, chip.value)}</span>
              {chip.count >= 0 && <span className={chip.selected ? undefined : "text-muted"}>{chip.count}</span>}
              {chip.selected && <span className="sr-only">{`(${words.chosen})`}</span>}
            </a>
          );
        })}
      </div>
    );
  };

  const asking = q.trim() !== "";
  const sortRow = (
    <div role="group" aria-labelledby={`${ids.more}-order`} className="flex flex-wrap items-center gap-2">
      <span id={`${ids.more}-order`} className="mr-1 text-sm text-muted">
        {words.order}
      </span>
      {DOCS_SORTS.map((value) => (
        <a
          key={value}
          href={addressOf({ ...state, sort: value })}
          onClick={pick({ sort: value })}
          aria-current={sort === value ? "true" : undefined}
          className={`${CHIP} ${sort === value ? "border-foreground bg-foreground text-background" : "border-border hover:bg-surface"}`}
        >
          {value === "relevance" && !asking ? words.sorts.reading : words.sorts[value]}
        </a>
      ))}
    </div>
  );

  const showing = status === "done" || (status === "loading" && results.length > 0);
  const none = status === "done" && current !== null && current.total === 0;
  const statusText =
    status === "busy"
      ? words.busy
      : status === "failed"
        ? words.failed
        : status === "done" && current
          ? current.total === 0
            ? current.q.trim() === ""
              ? words.noneHere
              : fillWords(current.found === 0 ? words.none : words.noneFiltered, { q: current.q })
            : current.total === 1
              ? words.result
              : fillWords(words.results, { n: current.total })
          : status === "idle"
            ? words.start
            : "";
  const clearHref = addressOf({ ...state, filters: NO_FILTERS });
  const ask = () => {
    if (onAsk) onAsk(q.trim());
    else window.dispatchEvent(new CustomEvent(DOCS_ASK_EVENT, { detail: { question: q.trim() } }));
  };

  return (
    <div className="flex flex-col gap-4">
      <form role="search" action={searchHref} method="get" onSubmit={onSubmit} aria-label={words.title} className="flex flex-col gap-2">
        <label htmlFor={ids.field} className={mode === "dialog" ? "sr-only" : "text-sm font-medium"}>
          {words.label}
        </label>
        <div className="flex gap-2">
          <input
            ref={input}
            id={ids.field}
            type="search"
            name="q"
            value={q}
            onChange={(event) => setQ(event.target.value)}
            onKeyDown={onFieldKey}
            maxLength={DOCS_QUERY_MAX}
            placeholder={words.placeholder}
            autoComplete="off"
            spellCheck={false}
            enterKeyHint="search"
            aria-describedby={ids.keys}
            aria-controls={ids.list}
            className="min-h-11 w-full min-w-0 rounded-lg border border-border bg-background px-3 text-base"
            data-docs-search-field=""
          />
          <button type="submit" className="min-h-11 shrink-0 rounded-lg border border-border px-4 text-sm font-medium hover:bg-surface">
            {words.submit}
          </button>
        </div>
        {(["track", "kind", "area", "lang"] as const).map((facet) =>
          filters[facet].length > 0 ? <input key={facet} type="hidden" name={facet} value={filters[facet].join(",")} /> : null,
        )}
        {filters.section && <input type="hidden" name="section" value={filters.section} />}
        {sort !== "relevance" && <input type="hidden" name="sort" value={sort} />}
        <p id={ids.keys} className="text-xs text-muted">
          {mode === "dialog" ? words.keys : words.keysPage}
        </p>
      </form>

      <div className="flex flex-col gap-2">
        {filters.section && (
          <div className="flex flex-wrap items-center gap-2">
            <a href={addressOf({ ...state, filters: { ...filters, section: null } })} onClick={pick({ filters: { ...filters, section: null } })} className={`${CHIP} border-foreground bg-foreground text-background`}>
              <span aria-hidden="true">✓</span>
              <span>{fillWords(words.inSection, { section: sectionTitle ?? filters.section })}</span>
              <span className="sr-only">{`(${words.chosen})`}</span>
            </a>
          </div>
        )}
        {facetRow("track")}
        {facetRow("lang")}
        <details open={moreOpen} onToggle={(event) => setMoreOpen(event.currentTarget.open)} className="text-sm">
          <summary className="inline-flex min-h-8 cursor-pointer items-center font-medium">{words.moreFilters}</summary>
          <div className="mt-2 flex flex-col gap-2">
            {facetRow("kind")}
            {facetRow("area")}
            {sortRow}
          </div>
        </details>
        {hasFilters(filters) && (
          <p>
            <a href={clearHref} onClick={pick({ filters: NO_FILTERS })} className="inline-flex min-h-6 items-center text-sm underline underline-offset-2 hover:no-underline">
              {words.clear}
            </a>
          </p>
        )}
      </div>

      <div className="flex flex-col gap-2">
        <p className="flex min-h-6 items-center gap-2 text-sm">
          <span id={ids.status} role="status" aria-live="polite" className={none ? "font-medium" : "text-muted"}>
            {statusText}
          </span>
          {status === "loading" && <span aria-hidden="true" className="inline-block size-3 animate-pulse rounded-full bg-muted" />}
        </p>
        {status === "done" && current?.match === "any" && current.total > 0 && <p className="text-sm">{words.some}</p>}
        {none && current && (
          <div className="flex flex-col gap-2 rounded-lg border border-border p-4 text-sm">
            {current.found > 0 || (hasFilters(filters) && current.q.trim() === "") ? (
              <p>
                <a href={clearHref} onClick={pick({ filters: NO_FILTERS })} className="inline-flex min-h-6 items-center font-medium underline underline-offset-2 hover:no-underline">
                  {words.allDocs}
                </a>
              </p>
            ) : (
              <>
                <p>{words.tips}</p>
                {hasFilters(filters) && (
                  <p>
                    <a href={clearHref} onClick={pick({ filters: NO_FILTERS })} className="inline-flex min-h-6 items-center underline underline-offset-2 hover:no-underline">
                      {words.allDocs}
                    </a>
                  </p>
                )}
                {guide && (
                  <div className="flex flex-col gap-1">
                    {mode === "dialog" ? (
                      <button type="button" onClick={ask} className="inline-flex min-h-11 w-fit items-center rounded-full border border-border px-4 font-medium hover:bg-surface">
                        {words.ask}
                      </button>
                    ) : (
                      <a href={`${homeHref}${docsAskSub(current.q)}`} className="inline-flex min-h-11 w-fit items-center rounded-full border border-border px-4 font-medium hover:bg-surface">
                        {words.ask}
                      </a>
                    )}
                    <p className="text-muted">{words.askLead}</p>
                  </div>
                )}
                <p className="text-muted">{words.counted}</p>
              </>
            )}
          </div>
        )}
        {/* Always there, so the field's aria-controls names a list that exists, empty or not. */}
        <ul ref={list} id={ids.list} onKeyDown={onListKey} className="flex flex-col gap-1">
          {showing && results.map((hit) => <DocsHit key={hit.doc} hit={hit} words={words} names={names} uiLang={uiLang} />)}
        </ul>
        {status === "done" && current?.next && (
          <p>
            <a
              href={addressOf(state, current.next)}
              onClick={(event) => {
                if (!plainClick(event) || !current.next) return;
                event.preventDefault();
                void run(state, current.next);
              }}
              className="inline-flex min-h-11 items-center rounded-full border border-border px-4 text-sm font-medium hover:bg-surface"
            >
              {words.more}
            </a>
          </p>
        )}
        {mode === "dialog" && wants(state) && (
          <p className="text-sm">
            <a href={addressOf(state)} className="inline-flex min-h-6 items-center text-muted underline underline-offset-2 hover:no-underline">
              {words.asPage}
            </a>
          </p>
        )}
      </div>
    </div>
  );
}

/** One result: where it is (track, section, or what kind of reference item), its title and heading, its code, its words, its kind. */
function DocsHit({ hit, words, names, uiLang }: { hit: DocsSearchHit; words: DocsFinderWords; names: DocsSearchNames; uiLang: DocLang }) {
  const where = [names.tracks[hit.track], hit.section?.title ?? (hit.item === "section" ? null : words.items[hit.item])].filter(Boolean).join(" › ");
  const heading = hit.headings[hit.headings.length - 1] ?? null;
  return (
    <li>
      <a href={hit.href} data-docs-hit="" className="flex flex-col gap-1 rounded-lg p-3 outline-offset-0 hover:bg-surface focus-visible:bg-surface">
        <span className="text-xs text-muted">{where}</span>
        <span className="font-semibold">
          {hit.title}
          {heading && <span className="font-normal">{` › ${heading}`}</span>}
        </span>
        {hit.code && <code className="w-fit rounded bg-surface px-1.5 font-mono text-xs">{hit.code}</code>}
        {hit.snippet.length > 0 && (
          <span className="text-sm text-muted">
            {hit.snippet.map((part, i) =>
              part.hit ? (
                <mark key={i} className="rounded-sm bg-transparent font-semibold text-foreground">
                  {part.text}
                </mark>
              ) : (
                <span key={i}>{part.text}</span>
              ),
            )}
          </span>
        )}
        <span className="flex flex-wrap gap-x-3 text-xs text-muted">
          <span>{words.kinds[hit.kind]}</span>
          {hit.lang !== uiLang && <span lang={hit.lang === "nb" ? "nb" : "en"}>{names.langs[hit.lang]}</span>}
        </span>
      </a>
    </li>
  );
}
