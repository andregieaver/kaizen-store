"use client";

import { useRouter } from "next/navigation";
import { useEffect, useEffectEvent, useId, useRef, useState, useTransition } from "react";

import { SearchSnippetFields } from "@/components/admin/seo-fields";
import { TermPicker } from "@/components/admin/terms";
import { shrinkImage } from "@/lib/image-resize";
import {
  ALT_MAX,
  AUTHOR_MAX,
  LAYOUT_TYPES,
  PAGE_SLUG_MAX,
  PAGE_TITLE_MAX,
  newPageContent,
  pageExcerpt,
  pageSlugFromTitle,
  pageSlugProblem,
  sitePartsFor,
  type HeaderOverlay,
  type PageContent,
  type PageRow,
  type PageType,
  type PageThumbnail,
} from "@/lib/page-content";
import { copyRow, newBlock, newRow } from "@/lib/page-rows";
import { DEFAULT_PRODUCT_LAYOUT } from "@/lib/product-layout";
import { defaultFooter, defaultHeader, type StandardMenus } from "@/lib/site-layout";
import { applyTranslated, translationItems, type TranslateMode } from "@/lib/page-translate-ai";
import {
  localizePage,
  translationOf,
  translationProgress,
  withTranslation,
  type PageLanguage,
} from "@/lib/page-translation";
import {
  currentGlobal,
  editedGlobals,
  refreshUses,
  sameJson,
  settleUses,
  type GlobalPart,
} from "@/lib/global-parts";
import { globalsOf, type SavedPart } from "@/lib/saved-parts";
import type { Term } from "@/lib/taxonomy";
import type { EditablePage, PageState } from "@/server/pages";

import { CssPanel } from "./css-panel";
import type { Upload } from "./image-upload";
import type { PageOwnerContext, PageSaveState } from "./page-context";
import { ColorField, newId, PageBuilder } from "./page-builder";

const input = "min-h-10 w-full rounded-md border border-border bg-background px-3 text-sm font-normal";
const label = "flex flex-col gap-1 text-sm font-medium";
const card = "flex flex-col gap-4 rounded-lg border border-border bg-background p-5";
const small = "min-h-9 rounded-md border border-border px-3 text-sm disabled:opacity-40";
const hint = "text-xs font-normal text-muted";

const STATE_TEXT: Record<PageState, string> = {
  draft: "Draft: not on the site",
  published: "Published",
  changed: "Published, with changes not yet published",
};

/** A new page starts with one full-width row holding an empty text block. */
function startingRows(type: PageType, owner: string | null, menus: StandardMenus): PageRow[] {
  // A product layout (D79), header or footer (D80) starts as the standard one, to change from.
  if (type === "product_layout") return DEFAULT_PRODUCT_LAYOUT.rows.map((row) => copyRow(row, newId));
  if (type === "header") return defaultHeader(owner, menus).rows.map((row) => copyRow(row, newId));
  if (type === "footer") return defaultFooter(owner, menus).rows.map((row) => copyRow(row, newId));
  const row = newRow("1", newId);
  row.columns[0].blocks.push(newBlock("richText", newId));
  return [row];
}

/**
 * A page (D42), Kaizen's or a store's (D53), held whole in the browser:
 * title, address, picture, search texts, who may read it, and its content:
 * rows of columns of blocks, built in `PageBuilder` (D43). Save keeps a
 * draft; Publish puts the page on the site. What differs between owners
 * comes in `context`.
 */
export function PageEditor({
  page,
  notice = null,
  savedParts,
  library = [],
  terms: initialTerms,
  gridTerms = {},
  context,
}: {
  page: EditablePage | null;
  /** Said when the editor opens, such as "Draft saved." after a new page's first save. */
  notice?: string | null;
  /** The owner's saved rows, columns and components, for the builder's Saved tab (D46). */
  savedParts: SavedPart[];
  /** Kaizen's saved parts as a starter library, on a store's pages (D56). */
  library?: SavedPart[];
  /** The owner's page and article categories and tags, for content grids (D57); this type's are `terms`. */
  gridTerms?: Partial<Record<PageType, Term[]>>;
  /** The owner's page categories and tags (D50). */
  terms: Term[];
  context: PageOwnerContext;
}) {
  const { actions, origin, defaultDescription, upload, reserved, adminBase, siteBase } = context;
  const [terms, setTerms] = useState(initialTerms);
  const router = useRouter();
  const [saved, setSaved] = useState<EditablePage | null>(page);
  // What is being edited: a page, or an article in the blog (D57), which starts with its writer as author.
  const noun =
    context.type === "product_layout" ? "layout" : context.type === "header" || context.type === "footer" ? context.type : context.type === "article" ? "article" : "page";
  // A product layout (D79), header or footer (D80) is only its name and its rows: no address, picture, search texts or categories.
  const layout = LAYOUT_TYPES.includes(context.type);
  // The owner's saved parts, and its globals (D98) as this editor knows them: what the page's uses are compared with.
  const [parts, setParts] = useState<SavedPart[]>(savedParts);
  const known = useRef<Map<string, GlobalPart>>(globalsOf(savedParts));
  const [content, setContent] = useState<PageContent>(() => {
    const start = page?.draft ?? {
      ...newPageContent(),
      rows: startingRows(context.type, context.owner, context.standardMenus),
      ...(context.type === "article" && context.defaultAuthor ? { author: context.defaultAuthor } : {}),
    };
    // Uses of globals as they are now; a use of one deleted is the page's own.
    const globals = globalsOf(savedParts);
    return refreshUses(start, globals, (id) => !globals.has(id));
  });
  // The page as last changed, to tell whether a save's answer may replace it.
  const latest = useRef(content);
  useEffect(() => {
    latest.current = content;
  }, [content]);
  // The address follows the title until it is edited, and never once the page is live.
  const [slugFollows, setSlugFollows] = useState(
    !page || (!page.published && page.draft.slug === pageSlugFromTitle(page.draft.title, reserved)),
  );
  const [dirty, setDirty] = useState(false);
  const [problems, setProblems] = useState<string[]>([]);
  const [message, setMessage] = useState<string | null>(notice);
  const [busy, startBusy] = useTransition();
  const [confirmDelete, setConfirmDelete] = useState(false);
  // The language being written (D55): the main one builds the page; another only says its texts.
  const [main, ...others] = context.languages;
  const [locale, setLocale] = useState(main.locale);
  // The CSS panel (D100): the page's own CSS, and the site's as written there (saved from the panel).
  const [cssOpen, setCssOpen] = useState(false);
  const [siteCss, setSiteCss] = useState(context.siteCss);
  const language = context.languages.find((l) => l.locale === locale) ?? main;
  const translating = language.locale !== main.locale;

  /**
   * Changes the page; while translating, the change is made to the page as
   * it reads in that language, and what then differs from the main
   * language's texts becomes its translation.
   */
  const edit = (update: (page: PageContent) => PageContent) => {
    setContent((current) => {
      let next: PageContent;
      if (!translating) next = update(current);
      else {
        const edited = update(localizePage(current, locale));
        next = withTranslation(current, locale, translationOf(current, edited));
      }
      // A change to one use of a global reaches the page's other uses of it at once (D98).
      return settleUses(current, next, known.current);
    });
    setDirty(true);
    setMessage(null);
  };
  const change = (next: Partial<PageContent>) => edit((current) => ({ ...current, ...next }));
  // The page's CSS is the same in every language, so it changes the page itself, also while translating.
  const changeCss = (css: string) => {
    setContent((current) => ({ ...current, css: css || undefined }));
    setDirty(true);
    setMessage(null);
  };
  // Rows change by function: a text block's editor reports from an earlier render.
  const changeRows = (update: (rows: PageRow[]) => PageRow[]) => edit((current) => ({ ...current, rows: update(current.rows) }));
  /** The page as the language being written reads. */
  const view = translating ? localizePage(content, locale) : content;

  // Leaving with unsaved changes asks first.
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const submit = (publish: boolean) =>
    startBusy(async () => {
      setProblems([]);
      const sent = content;
      // The globals changed here (D98): the server takes them from this page to every page using them.
      const globalEdits = editedGlobals(sent, known.current);
      const outcome: PageSaveState = await actions.save(saved?.id ?? null, JSON.stringify({ ...sent, globalEdits }), publish);
      if (outcome.status === "error") {
        setProblems(outcome.problems);
        return;
      }
      if (globalEdits.length > 0) {
        const now = new Map(known.current);
        for (const id of globalEdits) {
          const global = now.get(id);
          if (global) now.set(id, currentGlobal(sent, global));
        }
        known.current = now;
        setParts((list) => list.map((p) => (now.has(p.id) && globalEdits.includes(p.id) ? ({ ...p, ...now.get(p.id)! } as SavedPart) : p)));
      }
      // The server brings the page's other uses up to date; take its version unless the page changed meanwhile.
      if (latest.current === sent && !sameJson(outcome.page.draft, sent)) setContent(outcome.page.draft);
      setDirty(false);
      setSaved(outcome.page);
      setMessage(publish ? `Published at ${siteBase}/${outcome.page.slug}.` : "Draft saved.");
      // A new page moves to its own address; the editor there says what happened.
      if (!saved) router.replace(`${adminBase}/${outcome.page.id}?saved=${publish ? "published" : "draft"}`);
    });

  // Ctrl/Cmd + S saves the draft.
  const onKey = useEffectEvent((event: KeyboardEvent) => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
      event.preventDefault();
      if (!busy) submit(false);
    }
  });
  useEffect(() => {
    const listener = (event: KeyboardEvent) => onKey(event);
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, []);

  const unpublish = () =>
    startBusy(async () => {
      if (!saved) return;
      const outcome = await actions.unpublish(saved.id);
      if (outcome.status === "error") setProblems(outcome.problems);
      else {
        setSaved(outcome.page);
        setMessage(`Taken off the site. The ${noun} is a draft again.`);
      }
    });

  const remove = () =>
    startBusy(async () => {
      if (!saved) return;
      setDirty(false);
      const outcome = await actions.remove(saved.id);
      if (outcome) setProblems(outcome.problems);
    });

  const liveSlug = saved?.published ? saved.slug : null;
  const moving = liveSlug !== null && content.slug !== liveSlug && pageSlugProblem(content.slug, reserved) === null;
  const excerpt = pageExcerpt(view);
  const state: PageState | null = saved ? (dirty && saved.published ? "changed" : saved.state) : null;

  return (
    // Full width (see `AdminMain`): a left sidebar, the content and a right sidebar, a quarter, a half and a quarter.
    <div className="flex flex-col gap-6 pb-28">
      <PageBuilder
        // A new language starts with its dialogs closed.
        key={locale}
        lang={language.locale.split("-")[0]}
        rows={view.rows}
        onRows={changeRows}
        translate={translating ? { name: language.name, mainName: main.name, source: content.rows } : null}
        css={[siteCss, content.css ?? ""]}
        saved={parts}
        onSaved={(next) => {
          // A global changed or deleted under Saved (the server has changed the pages using it): its uses here follow.
          const before = new Map(parts.map((p) => [p.id, p]));
          const globals = globalsOf(next);
          const changed = new Map([...globals].filter(([id]) => before.get(id)?.global && before.get(id)?.updatedAt !== next.find((p) => p.id === id)?.updatedAt));
          const gone = new Set([...known.current.keys()].filter((id) => !globals.has(id)));
          known.current = globals;
          setParts(next);
          if (changed.size > 0 || gone.size > 0) setContent((current) => refreshUses(current, changed, (id) => gone.has(id)));
        }}
        library={library}
        productParts={context.type === "product_layout"}
        shopParts={context.type === "page" && context.owner !== null}
        siteParts={context.type === "header" || context.type === "footer" ? sitePartsFor(context.owner) : null}
        upload={upload}
        startVideo={context.startVideo}
        fonts={{ ...context.fonts, install: context.actions.installFont, theme: context.theme }}
        grid={{
          pageId: saved?.id ?? null,
          owner: context.owner,
          pageTerms: context.type === "page" ? terms : (gridTerms.page ?? []),
          articleTerms: context.type === "article" ? terms : (gridTerms.article ?? []),
          stores: context.gridStores,
          menus: context.menus,
          menusHref: context.menusHref,
          actions,
        }}
        aside={
          <>
            {others.length > 0 && (
              <LanguageField
                languages={context.languages}
                value={locale}
                onChange={setLocale}
                progress={(l) => translationProgress(content, l)}
              />
            )}
            {others.length > 0 && actions.translate && (
              <TranslateWithAi
                languages={context.languages}
                current={locale}
                content={content}
                translate={actions.translate}
                onTranslated={(target, done) => {
                  setContent((current) => withTranslation(current, target, applyTranslated(current, current.translations?.[target] ?? {}, done)));
                  setDirty(true);
                  setMessage(null);
                }}
                onShow={setLocale}
              />
            )}
            <section aria-label={layout ? "Name" : "Title and address"} className={card}>
              <label className={label}>
                {layout ? `${noun[0].toUpperCase()}${noun.slice(1)} name` : translating ? `Title in ${language.name}` : "Title"}
                <input
                  value={view.title}
                  maxLength={PAGE_TITLE_MAX}
                  onChange={(event) => {
                    const title = event.target.value;
                    // The address is one for all languages, made from the main title.
                    change(slugFollows && !translating ? { title, slug: pageSlugFromTitle(title, reserved) } : { title });
                  }}
                  placeholder={
                    context.type === "article"
                      ? "What we learned this spring"
                      : context.type === "header"
                        ? "Header with a centred logo"
                        : context.type === "footer"
                          ? "Footer with four columns"
                          : layout
                            ? "Wide pictures"
                            : "About us"
                  }
                  className={`${input} min-h-12 text-xl font-semibold`}
                />
              </label>
              {layout ? (
                <p className={hint}>
                  {context.type === "product_layout"
                    ? "Only for you: shoppers see the product it is used for."
                    : `Only for you: once chosen, visitors see the ${context.type} on every page.`}
                </p>
              ) : translating ? (
                <p className={hint}>
                  The address, {content.slug}, is the same in every language. Change it in {main.name}.
                </p>
              ) : (
              <SlugField
                slug={content.slug}
                follows={slugFollows}
                origin={origin}
                siteBase={siteBase}
                reserved={reserved}
                onChange={(slug) => {
                  setSlugFollows(false);
                  change({ slug });
                }}
                onFollow={() => {
                  setSlugFollows(!liveSlug);
                  change({ slug: pageSlugFromTitle(content.title, reserved) });
                }}
              />
              )}
              {moving && !translating && !layout && (
                <p className="rounded-md bg-surface p-3 text-sm">
                  When you publish, <strong>{siteBase}/{liveSlug}</strong> will lead to <strong>{siteBase}/{content.slug}</strong> for good
                  (a permanent redirect), so links and search results keep working.
                </p>
              )}
            </section>
            {!translating && context.type === "header" && (
              <HeaderOverlayFields
                value={content.overlay}
                kaizen={context.owner === null}
                terms={terms}
                onChange={(overlay) => change({ overlay })}
                onTerms={setTerms}
                create={actions.createTerm}
                manageHref={`${adminBase.replace(/\/headers$/, "/pages")}/categories`}
              />
            )}
            {!translating && !layout && (
            <>
            {context.type === "article" && (
              <section aria-labelledby="author-heading" className={card}>
                <h2 id="author-heading" className="font-medium">
                  Author
                </h2>
                <div className="flex flex-col gap-1">
                  <label className={label}>
                    Written by
                    <input
                      value={content.author ?? ""}
                      maxLength={AUTHOR_MAX}
                      onChange={(event) => change({ author: event.target.value })}
                      placeholder="Name"
                      aria-describedby="author-hint"
                      className={input}
                    />
                  </label>
                  <span id="author-hint" className={hint}>
                    Shown under the title with the date, and told to search engines. Empty shows{" "}
                    {context.owner === null ? "Kaizen" : "the store"} as the author.
                  </span>
                </div>
              </section>
            )}
            <section aria-labelledby="terms-heading" className={card}>
              <h2 id="terms-heading" className="font-medium">
                Categories and tags
              </h2>
              <TermPicker
                terms={terms}
                value={{ categories: content.categories, tags: content.tags }}
                onChange={(ids) => change(ids)}
                onTerms={setTerms}
                create={actions.createTerm}
                manageHref={`${adminBase}/categories`}
              />
            </section>
            <ThumbnailField
              value={content.thumbnail}
              upload={upload}
              onChange={(thumbnail) => change({ thumbnail })}
            />
            <section aria-labelledby="visibility-heading" className={card}>
              <h2 id="visibility-heading" className="font-medium">
                Who may read it
              </h2>
              <Switch
                checked={content.searchEngines}
                onChange={(searchEngines) => change({ searchEngines })}
                title="Search engines"
                help="Google, Bing and others may list the page. Off: the page asks not to be indexed and is left out of the sitemap."
              />
              <Switch
                checked={content.aiAssistants}
                onChange={(aiAssistants) => change({ aiAssistants })}
                title="AI assistants"
                help="ChatGPT, Claude, Perplexity and others may read the page. Off: it is left out of llms.txt and robots.txt asks AI crawlers to stay away."
              />
            </section>
            </>
            )}
            {translating && view.thumbnail && (
              <section aria-labelledby="thumbnail-alt-heading" className={card}>
                <h2 id="thumbnail-alt-heading" className="font-medium">
                  Picture
                </h2>
                <label className={label}>
                  Description of the picture in {language.name}
                  <textarea
                    value={view.thumbnail.alt}
                    maxLength={ALT_MAX}
                    rows={2}
                    onChange={(event) => view.thumbnail && change({ thumbnail: { ...view.thumbnail, alt: event.target.value } })}
                    className={`${input} py-2`}
                  />
                  <span className={hint}>In {main.name}: {content.thumbnail?.alt || "no description"}</span>
                </label>
              </section>
            )}
            {!layout && (
            <section aria-labelledby="search-heading" className={card}>
              <h2 id="search-heading" className="font-medium">
                Search and sharing
              </h2>
              <SearchSnippetFields
                value={view.seo}
                onChange={(seo) => change({ seo })}
                fallback={{
                  title: view.title || `The ${noun}'s title`,
                  description: excerpt || defaultDescription,
                }}
                url={`${origin}${siteBase}/${content.slug}`}
                lang={language.locale}
              />
              <p className={hint}>
                Empty fields use the title and the start of the text. When shared, the page shows its picture.
              </p>
            </section>
            )}
          </>
        }
      />

      {problems.length > 0 && (
        <div role="alert" className="rounded-lg border border-red-700 p-4 text-sm">
          <p className="font-medium">Nothing was saved yet. Please fix:</p>
          <ul className="mt-2 list-disc pl-5">
            {problems.map((problem) => (
              <li key={problem}>{problem}</li>
            ))}
          </ul>
        </div>
      )}

      <CssPanel
        open={cssOpen}
        onClose={() => setCssOpen(false)}
        noun={noun}
        siteName={context.owner === null ? "Kaizen's site" : "your store"}
        pageCss={content.css ?? ""}
        onPageCss={changeCss}
        siteCss={siteCss}
        onSiteCss={setSiteCss}
        saveSiteCss={actions.saveSiteCss}
      />

      <div className="fixed inset-x-0 bottom-0 z-20 border-t border-border bg-background/95 backdrop-blur">
        <div className="flex flex-wrap items-center gap-2 px-4 py-3">
          <button
            type="button"
            onClick={() => submit(false)}
            disabled={busy}
            className="min-h-11 rounded-md border border-border px-4 font-medium disabled:opacity-50"
          >
            Save draft
          </button>
          <button
            type="button"
            onClick={() => submit(true)}
            disabled={busy}
            className="min-h-11 rounded-md bg-foreground px-5 font-medium text-background disabled:opacity-50"
          >
            {busy ? "Saving …" : saved?.published ? "Publish changes" : "Publish"}
          </button>
          <p role="status" aria-live="polite" className="text-sm">
            {message ?? (dirty ? "Unsaved changes." : state ? STATE_TEXT[state] : "Not saved yet.")}
          </p>
          <button
            type="button"
            onClick={() => setCssOpen((open) => !open)}
            aria-expanded={cssOpen}
            aria-controls="css-panel"
            className="flex min-h-11 items-center gap-2 rounded-md border border-border px-4 text-sm font-medium hover:bg-surface"
          >
            <span aria-hidden className="font-mono">{"{ }"}</span>
            Custom CSS
            {(content.css || siteCss.trim()) && <span className="size-2 rounded-full bg-violet-600" title="Has custom CSS" />}
          </button>
          <div className="ml-auto flex flex-wrap items-center gap-3 text-sm">
            {saved && (
              <a href={`${adminBase}/${saved.id}/preview`} target="_blank" rel="noopener" className="underline">
                Preview draft{dirty ? " (last saved)" : ""}
              </a>
            )}
            {liveSlug && !layout && (
              <a href={`${siteBase}/${liveSlug}`} target="_blank" rel="noopener" className="underline">
                View {noun}
              </a>
            )}
            {saved?.published && (
              <button type="button" onClick={unpublish} disabled={busy} className="underline disabled:opacity-50">
                Unpublish
              </button>
            )}
            {saved &&
              (confirmDelete ? (
                <span className="flex items-center gap-2">
                  Delete for good?
                  <button
                    type="button"
                    onClick={remove}
                    disabled={busy}
                    className="min-h-9 rounded-md bg-red-700 px-3 text-white disabled:opacity-50"
                  >
                    Delete {noun}
                  </button>
                  <button type="button" onClick={() => setConfirmDelete(false)} className="underline">
                    Keep it
                  </button>
                </span>
              ) : (
                <button type="button" onClick={() => setConfirmDelete(true)} className="text-red-700 underline dark:text-red-400">
                  Delete
                </button>
              ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function SlugField({
  slug,
  follows,
  origin,
  siteBase,
  reserved,
  onChange,
  onFollow,
}: {
  slug: string;
  follows: boolean;
  origin: string;
  siteBase: string;
  reserved: readonly string[];
  onChange: (slug: string) => void;
  onFollow: () => void;
}) {
  const id = useId();
  const problem = slug ? pageSlugProblem(slug, reserved) : null;
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-sm font-medium">
        Address
      </label>
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex min-w-0 flex-1 items-center rounded-md border border-border focus-within:outline-2">
          <span aria-hidden className="shrink-0 pl-3 text-sm text-muted">
            /
          </span>
          <input
            id={id}
            value={slug}
            maxLength={PAGE_SLUG_MAX}
            onChange={(event) => onChange(event.target.value.toLowerCase().replace(/\s+/g, "-"))}
            spellCheck={false}
            aria-invalid={problem ? true : undefined}
            aria-describedby={`${id}-hint`}
            className="min-h-10 min-w-0 flex-1 bg-transparent pr-3 text-sm outline-none"
          />
        </div>
        {!follows && (
          <button type="button" onClick={onFollow} className={small}>
            Make from title
          </button>
        )}
      </div>
      <span id={`${id}-hint`} className={problem ? "text-xs text-red-700 dark:text-red-400" : hint}>
        {problem ?? (
          <>
            <span className="block break-all text-foreground">
              {origin.replace(/^https?:\/\//, "")}
              {siteBase}/{slug}
            </span>
            {follows ? "Made from the title as you type. Edit it to choose your own." : "Lowercase letters, digits and hyphens."}
          </>
        )}
      </span>
    </div>
  );
}

function Switch({
  checked,
  onChange,
  title,
  help,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  title: string;
  help: string;
}) {
  const id = useId();
  return (
    <div className="flex items-start gap-3">
      <input
        id={id}
        type="checkbox"
        role="switch"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        aria-describedby={`${id}-help`}
        className="mt-0.5 size-5 shrink-0 accent-foreground"
      />
      <div className="flex flex-col gap-0.5">
        <label htmlFor={id} className="text-sm font-medium">
          {title}: {checked ? "welcome" : "kept out"}
        </label>
        <span id={`${id}-help`} className={hint}>
          {help}
        </span>
      </div>
    </div>
  );
}

function ThumbnailField({
  value,
  upload,
  onChange,
}: {
  value: PageThumbnail | null;
  upload: Upload | null;
  onChange: (value: PageThumbnail | null) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const choose = async (file: File | undefined) => {
    if (!file || !upload) return;
    setBusy(true);
    setProblem(null);
    try {
      const [image, thumbnail] = await Promise.all([shrinkImage(file, 1600), shrinkImage(file, 480)]);
      const size = await createImageBitmap(image);
      const ext = image.type === "image/webp" ? "webp" : "jpg";
      const data = new FormData();
      data.set("image", new File([image], `page.${ext}`, { type: image.type }));
      // Its name as it was on the owner's computer, for the media library (D88).
      data.set("name", file.name);
      data.set("thumbnail", new File([thumbnail], `page-480.${ext}`, { type: thumbnail.type }));
      const outcome = await upload(data);
      if (outcome.ok) onChange({ url: outcome.url, width: size.width, height: size.height, alt: value?.alt ?? "" });
      else setProblem(outcome.problem);
      size.close();
    } catch {
      setProblem(`${file.name} could not be read as a picture. Use a JPEG, PNG, WebP or AVIF.`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section aria-labelledby="thumbnail-heading" className={card}>
      <div>
        <h2 id="thumbnail-heading" className="font-medium">
          Picture
        </h2>
        <p className="text-sm text-muted">Shown when the page is shared, and in lists. Wide pictures work best.</p>
      </div>
      {value ? (
        // eslint-disable-next-line @next/next/no-img-element -- admin preview of the uploaded picture
        <img src={value.url} alt="" className="aspect-[1200/630] w-full rounded-md border border-border object-cover" />
      ) : (
        <div className="flex aspect-[1200/630] w-full items-center justify-center rounded-md border border-dashed border-border bg-surface text-sm text-muted">
          No picture
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2 text-sm">
        {upload ? (
          <label className="cursor-pointer rounded-md border border-border px-3 py-2 focus-within:outline-2">
            {busy ? "Uploading …" : value ? "Replace picture" : "Upload picture"}
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp,image/avif"
              className="sr-only"
              disabled={busy}
              onChange={(event) => {
                void choose(event.target.files?.[0]);
                event.target.value = "";
              }}
            />
          </label>
        ) : (
          <p className="text-muted">Uploads are not set up on this server.</p>
        )}
        {value && (
          <button type="button" onClick={() => onChange(null)} className="rounded-md px-3 py-2 underline">
            Remove
          </button>
        )}
      </div>
      {value && (
        <label className={label}>
          Description of the picture
          <textarea
            value={value.alt}
            maxLength={ALT_MAX}
            rows={2}
            onChange={(event) => onChange({ ...value, alt: event.target.value })}
            placeholder="What the picture shows, for people who cannot see it"
            className={`${input} py-2`}
          />
          <span className={hint}>Leave it empty only if the picture is decoration.</span>
        </label>
      )}
      {problem && (
        <p role="alert" className="text-sm text-red-700 dark:text-red-400">
          {problem}
        </p>
      )}
    </section>
  );
}

/**
 * Which language is being written (D55): the main one builds the page, and
 * each other one has its own texts over it, with how many are done.
 */
function LanguageField({
  languages,
  value,
  onChange,
  progress,
}: {
  languages: PageLanguage[];
  value: string;
  onChange: (locale: string) => void;
  progress: (locale: string) => { done: number; of: number };
}) {
  const [main, ...others] = languages;
  return (
    <section aria-labelledby="language-heading" className={card}>
      <h2 id="language-heading" className="font-medium">
        Language
      </h2>
      <div role="radiogroup" aria-labelledby="language-heading" className="flex flex-wrap gap-2">
        {languages.map((language) => {
          const done = language === main ? null : progress(language.locale);
          return (
            <label
              key={language.locale}
              className="relative flex cursor-pointer flex-col rounded-md border border-border px-3 py-1.5 text-sm has-checked:border-foreground has-checked:bg-foreground has-checked:text-background has-focus-visible:outline-2"
            >
              <input
                type="radio"
                name="page-language"
                value={language.locale}
                checked={value === language.locale}
                onChange={() => onChange(language.locale)}
                className="sr-only"
              />
              <span className="font-medium">{language.name}</span>
              <span className="text-xs opacity-80">{done ? `${done.done} of ${done.of} texts` : "Main language"}</span>
            </label>
          );
        })}
      </div>
      <p className={hint}>
        The page is built in {main.name}. In {others.map((l) => l.name).join(", ")}, you translate its texts; a text not
        translated shows in {main.name}.
      </p>
    </section>
  );
}

/**
 * Translate with AI (D109): the page's texts go to the store's AI, which
 * writes each language's translation, or brings it up to date. What comes
 * back is put in the page as a draft translation, to read and change like
 * any text, and saved with the page; a text the AI could not translate
 * (too long, or with a claim the text did not have) stays in the main language.
 */
function TranslateWithAi({
  languages,
  current,
  content,
  translate,
  onTranslated,
  onShow,
}: {
  languages: PageLanguage[];
  current: string;
  content: PageContent;
  translate: NonNullable<PageOwnerContext["actions"]["translate"]>;
  onTranslated: (locale: string, done: Record<string, string | string[]>) => void;
  onShow: (locale: string) => void;
}) {
  const [main, ...others] = languages;
  // Translating into the language being written, or into every other language.
  const [target, setTarget] = useState<string>(others.some((l) => l.locale === current) ? current : "all");
  const [mode, setMode] = useState<TranslateMode>("missing");
  const [busy, start] = useTransition();
  const [result, setResult] = useState<{ ok: boolean; lines: string[] } | null>(null);
  const targets = target === "all" ? others : others.filter((l) => l.locale === target);
  const first = targets[0];
  // What there is to do, so the button says so and is off when there is nothing.
  const counts = targets.map((language) => ({ language, texts: translationItems(content, language.locale, mode).length }));
  const total = counts.reduce((sum, c) => sum + c.texts, 0);

  const run = () =>
    start(async () => {
      setResult(null);
      const lines: string[] = [];
      let ok = true;
      for (const { language } of counts) {
        const items = translationItems(content, language.locale, mode);
        if (items.length === 0) continue;
        const outcome = await translate({ from: main.name, to: language.name, items });
        if (!outcome.ok) {
          ok = false;
          lines.push(`${language.name}: ${outcome.problem}`);
          break;
        }
        onTranslated(language.locale, outcome.done);
        const done = Object.keys(outcome.done).length;
        lines.push(`${language.name}: ${done} of ${items.length} texts translated.`);
        for (const skipped of outcome.skipped.slice(0, 5)) lines.push(`Left in ${main.name}: ${skipped.label}. ${skipped.reason}`);
        if (outcome.skipped.length > 5) lines.push(`…and ${outcome.skipped.length - 5} more left in ${main.name}.`);
      }
      setResult({ ok, lines });
      if (ok && targets.length === 1 && first) onShow(first.locale);
    });

  return (
    <section aria-labelledby="translate-ai-heading" className={card}>
      <h2 id="translate-ai-heading" className="font-medium">
        Translate with AI
      </h2>
      <label className={label}>
        Into
        <select value={target} onChange={(event) => setTarget(event.target.value)} disabled={busy} className={input}>
          {others.length > 1 && <option value="all">All other languages</option>}
          {others.map((language) => (
            <option key={language.locale} value={language.locale}>
              {language.name}
            </option>
          ))}
        </select>
      </label>
      <div role="radiogroup" aria-label="Which texts" className="flex flex-col gap-2 text-sm">
        <label className="flex items-start gap-2">
          <input type="radio" name="translate-mode" checked={mode === "missing"} onChange={() => setMode("missing")} disabled={busy} className="mt-1" />
          <span>Only texts not translated yet</span>
        </label>
        <label className="flex items-start gap-2">
          <input type="radio" name="translate-mode" checked={mode === "all"} onChange={() => setMode("all")} disabled={busy} className="mt-1" />
          <span>Translate everything again, replacing the translations there are</span>
        </label>
      </div>
      <button type="button" onClick={run} disabled={busy || total === 0} className={small}>
        {busy ? "Translating…" : total === 0 ? "Nothing to translate" : `Translate ${total} ${total === 1 ? "text" : "texts"}`}
      </button>
      <div role="status" aria-live="polite" className="flex flex-col gap-1 text-xs">
        {result?.lines.map((line, index) => (
          <p key={index} className={result.ok ? "text-muted" : "text-red-700 dark:text-red-400"}>
            {line}
          </p>
        ))}
        {result?.ok && <p className="text-muted">Read them over, then save the page.</p>}
      </div>
      <p className={hint}>
        Only the page&apos;s words go to the AI, translated from {main.name}. Nothing is saved until you save the page.
      </p>
    </section>
  );
}

/**
 * Where a header lies over the page (D80): nowhere, every page, the front
 * page (a store's) or pages in chosen page categories and tags; only over
 * pages whose first row has a background. Its text colour while over one.
 */
function HeaderOverlayFields({
  value,
  kaizen,
  terms,
  onChange,
  onTerms,
  create,
  manageHref,
}: {
  value: HeaderOverlay | undefined;
  kaizen: boolean;
  terms: Term[];
  onChange: (overlay: HeaderOverlay | undefined) => void;
  onTerms: (terms: Term[]) => void;
  create: PageOwnerContext["actions"]["createTerm"];
  manageHref: string;
}) {
  const id = useId();
  const where = value?.where ?? "none";
  const choices = [
    { value: "none", label: "Above the page" },
    { value: "everywhere", label: "Over every page" },
    ...(kaizen ? [] : [{ value: "front", label: "Over the front page" }]),
    { value: "terms", label: "Over pages in categories or tags" },
  ] as const;
  const set = (next: string) =>
    onChange(
      next === "none"
        ? undefined
        : { where: next as HeaderOverlay["where"], categories: value?.categories ?? [], tags: value?.tags ?? [], textColor: value?.textColor },
    );
  return (
    <section aria-labelledby={`${id}-heading`} className="flex flex-col gap-3 rounded-lg border border-border bg-background p-4">
      <h2 id={`${id}-heading`} className="font-medium">
        Over the page
      </h2>
      <p className="text-xs text-muted">
        The header can lie over the top of a page whose first row has a background of its own (a picture, a video or a
        colour), see-through until the visitor scrolls. Pages that start without one keep it above.
      </p>
      <fieldset className="flex flex-col gap-2">
        <legend className="sr-only">Where the header goes</legend>
        {choices.map((choice) => (
          <label key={choice.value} className="flex items-center gap-2 text-sm">
            <input type="radio" name={`${id}-where`} checked={where === choice.value} onChange={() => set(choice.value)} className="size-4" />
            {choice.label}
          </label>
        ))}
      </fieldset>
      {value?.where === "terms" && (
        <TermPicker
          terms={terms}
          value={{ categories: value.categories, tags: value.tags }}
          onChange={(ids) => onChange({ ...value, ...ids })}
          onTerms={onTerms}
          create={create}
          manageHref={manageHref}
        />
      )}
      {value && (
        <div className="flex flex-col gap-2">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={Boolean(value.textColor)}
              onChange={(event) => onChange({ ...value, textColor: event.target.checked ? "#ffffff" : undefined })}
              className="size-4"
            />
            Own text colour over the page
          </label>
          {value.textColor && <ColorField label="Text colour" value={value.textColor} onChange={(textColor) => onChange({ ...value, textColor })} />}
          <p className="text-xs text-muted">White suits a dark picture or video; scrolled, the header has its usual colours again.</p>
        </div>
      )}
    </section>
  );
}
