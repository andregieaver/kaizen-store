"use client";

import { useRouter } from "next/navigation";
import { useEffect, useEffectEvent, useId, useMemo, useRef, useState, useTransition } from "react";

import { applicableGroups, EntityFields } from "@/components/admin/entity-fields";
import { fieldFileUploader } from "@/components/admin/field-file-upload";
import { shrinkAndUpload } from "@/components/admin/fields-form";
import { SearchSnippetFields } from "@/components/admin/seo-fields";
import { TermPicker } from "@/components/admin/terms";
import { changesFrom, EMPTY_DATA, EMPTY_LOOKUPS, withParents, type FieldData } from "@/lib/custom-fields";
import { shrinkImage } from "@/lib/image-resize";
import {
  ALT_MAX,
  AUTHOR_MAX,
  LAYOUT_TYPES,
  EXCERPT_FIELD_MAX,
  PAGE_SLUG_MAX,
  joinPagePath,
  pageParentPath,
  pageSegment,
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
import { layoutOf } from "@/lib/page-layout";
import { blockingIssues, issueId, pageIssues, type PageIssue } from "@/lib/page-a11y";
import { applyMotionPlan, type MotionPlan } from "@/lib/motion-plan";
import { History, Redo2, Replace, Undo2, WandSparkles } from "lucide-react";
import { emptyHistory, historyKey, record, redo as redoStep, undo as undoStep, type History as EditHistory } from "@/lib/edit-history";
import type { PageVersionItem } from "@/lib/page-versions";

import { MakeCoolDialog } from "./make-cool-dialog";
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
import { replaceInPage, type FindOptions } from "@/lib/page-find-replace";
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
import { useAdminLang, useAdminText } from "./admin-text";
import { countWords, fillWords } from "@/lib/admin-fill";
import { ADMIN_LANG_FACTS } from "@/lib/admin-lang";
import type { Upload } from "./image-upload";
import type { PageOwnerContext, PageSaveState } from "./page-context";
import { ColourLibraryProvider } from "./colour-library";
import { ColourSwatches } from "./colour-field";
import { LibraryButton, MediaPickerProvider } from "./media-picker";
import { PictureMakerProvider } from "./picture-maker";
import { SignupCodesContext } from "./block-fields";
import { ColorField, newId, PageBuilder } from "./page-builder";
import { PageIssuesPanel, PublishWithIssuesDialog } from "./page-issues-panel";
import { FindReplaceDialog } from "./find-replace-dialog";
import { PageVersionsDialog } from "./page-versions-dialog";
import { SaveTemplateDialog, defaultTemplateName } from "./save-template-dialog";

const input = "min-h-10 w-full rounded-md border border-line bg-card px-3 text-sm font-normal";
const label = "flex flex-col gap-1 text-sm font-medium";
const card = "flex flex-col gap-4 rounded-lg border border-line bg-card p-5";
const small = "min-h-9 rounded-pill border border-edge px-3 text-sm disabled:opacity-40";
const hint = "text-xs font-normal text-muted";


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
  terms: initialTerms,
  gridTerms = {},
  fieldData: initialFieldData = EMPTY_DATA,
  fieldRoles = [],
  context,
}: {
  page: EditablePage | null;
  /** Said when the editor opens, such as "Draft saved." after a new page's first save. */
  notice?: string | null;
  /** The owner's saved rows, columns and components, for the builder's Saved tab (D46). */
  savedParts: SavedPart[];
  /** No longer used: Kaizen's saved parts reach a store through the builder's Templates tab (D125). */
  library?: SavedPart[];
  /** The owner's page and article categories and tags, for content grids (D57); this type's are `terms`. */
  gridTerms?: Partial<Record<PageType, Term[]>>;
  /** The owner's page categories and tags (D50). */
  terms: Term[];
  /** What is entered in the page's custom fields (D118), and the special pages it is chosen for (which group rules may ask about). */
  fieldData?: FieldData;
  fieldRoles?: string[];
  context: PageOwnerContext;
}) {
  const { actions, origin, defaultDescription, upload, reserved, adminBase, siteBase } = context;
  const w = useAdminText("builder");
  const ew = w.editor;
  const dateLocale = ADMIN_LANG_FACTS[useAdminLang()].locale;
  const [terms, setTerms] = useState(initialTerms);
  // The address a title makes, kept under the page's parent; the platform's reserved addresses are only for the top level.
  const slugFromTitle = (title: string, current = "") =>
    joinPagePath(pageParentPath(current), pageSlugFromTitle(title, pageParentPath(current) ? [] : reserved));
  const router = useRouter();
  const [saved, setSaved] = useState<EditablePage | null>(page);
  // What is being edited: a page, or an article in the blog (D57), which starts with its writer as author.
  const noun =
    context.type === "product_layout"
      ? "layout"
      : context.type === "header" || context.type === "footer"
        ? context.type
        : context.type === "variant"
          ? "version"
          : context.type === "article"
            ? "article"
            : "page";
  // A product layout (D79), header or footer (D80) is only its name and its rows: no address, picture, search texts or categories.
  const layout = LAYOUT_TYPES.includes(context.type);
  // A version made for an A/B test (D148) is made and removed with its test, never duplicated, unpublished or deleted on its own.
  const isVersion = context.type === "variant";
  // What a version stands in for (D148): a page, a product layout, a header or a footer, which decides what the builder offers for it.
  const shape: PageType = context.variantOf ?? context.type;
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
  // Undo and redo (D305): what the page was before each change; letters typed or a slider dragged close together are one step.
  const [history, setHistory] = useState<EditHistory<PageContent>>(emptyHistory);
  const remember = (kind: string) => {
    const before = latest.current;
    setHistory((h) => record(h, before, kind, Date.now()));
  };
  // The page's versions (D305).
  const [versionsOpen, setVersionsOpen] = useState(false);
  // Find and replace (D307).
  const [findOpen, setFindOpen] = useState(false);
  // The address follows the title until it is edited, and never once the page is live.
  const [slugFollows, setSlugFollows] = useState(
    !page || (!page.published && page.draft.slug === pageSlugFromTitle(page.draft.title, reserved)),
  );
  const [dirty, setDirty] = useState(false);
  const [fieldData, setFieldData] = useState(initialFieldData);
  const [problems, setProblems] = useState<string[]>([]);
  const [message, setMessage] = useState<string | null>(notice);
  const [busy, startBusy] = useTransition();
  const [confirmDelete, setConfirmDelete] = useState(false);
  // Publishing with a blocking problem asks first (wave 1, 1e): the problems the owner is being asked about, or none.
  const [asking, setAsking] = useState<PageIssue[] | null>(null);
  // The language being written (D55): the main one builds the page; another only says its texts.
  const [main, ...others] = context.languages;
  const [locale, setLocale] = useState(main.locale);
  // The CSS panel (D100): the page's own CSS, and the site's as written there (saved from the panel).
  const [cssOpen, setCssOpen] = useState(false);
  // Saving the page's layout as a template (D127).
  const [templateOpen, setTemplateOpen] = useState(false);
  // "Make my page cool" (D128): the AI manager adds motion; the rows from before are kept for one undo, and the canvas plays it.
  const [coolOpen, setCoolOpen] = useState(false);
  const [coolUndo, setCoolUndo] = useState<{ before: PageRow[]; after: PageRow[] } | null>(null);
  const [motionRequest, setMotionRequest] = useState(0);
  const [siteCss, setSiteCss] = useState(context.siteCss);
  const language = context.languages.find((l) => l.locale === locale) ?? main;
  const translating = language.locale !== main.locale;

  /**
   * Changes the page; while translating, the change is made to the page as
   * it reads in that language, and what then differs from the main
   * language's texts becomes its translation.
   */
  const edit = (update: (page: PageContent) => PageContent, kind = "edit") => {
    remember(kind);
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
    remember("css");
    setContent((current) => ({ ...current, css: css || undefined }));
    setDirty(true);
    setMessage(null);
  };
  // Rows change by function: a text block's editor reports from an earlier render.
  const changeRows = (update: (rows: PageRow[]) => PageRow[]) => edit((current) => ({ ...current, rows: update(current.rows) }));
  /** Puts the plan's motion on the page (nothing the owner already animated is changed) and shows it on the canvas. */
  const applyCool = (plan: MotionPlan) => {
    const before = content.rows;
    const result = applyMotionPlan(before, plan);
    if (result.changed === 0) {
      setMessage(ew.coolNothing);
      return;
    }
    changeRows(() => result.rows);
    setCoolUndo({ before, after: result.rows });
    setMotionRequest((n) => n + 1);
    setMessage(`${plan.summary}${plan.aiUsed ? "" : ` ${ew.coolNoAi}`}`);
  };
  const undoCool = () => {
    if (!coolUndo) return;
    changeRows(() => coolUndo.before);
    setCoolUndo(null);
    setMessage(ew.coolRemoved);
  };
  /** Takes back the last change, or puts back the one last taken back. */
  const step = (direction: "undo" | "redo") => {
    const moved = (direction === "undo" ? undoStep : redoStep)(history, content);
    if (!moved) return;
    setHistory(moved.history);
    setContent(moved.value);
    setDirty(true);
    setMessage(null);
  };
  /** A kept version (D305) in the editor, as unsaved changes: one step Undo takes back. */
  const takeVersion = (json: string, item: PageVersionItem) => {
    let parsed: PageContent;
    try {
      parsed = JSON.parse(json) as PageContent;
    } catch {
      setProblems([ew.versionUnreadable]);
      return;
    }
    remember("version");
    setContent(refreshUses(parsed, known.current, (id) => !known.current.has(id)));
    setDirty(true);
    setMessage(
      fillWords(ew.versionTaken, {
        when: new Intl.DateTimeFormat(dateLocale, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(item.at)),
      }),
    );
  };
  /** The page as the language being written reads. */
  const view = translating ? localizePage(content, locale) : content;
  /** Replaces the words in the texts chosen, in the language being written: one step of its own (never joined to typing), which Undo takes back. */
  const replaceWords = (query: string, replacement: string, options: FindOptions, only: ReadonlySet<string>) => {
    const outcome = replaceInPage(view, query, replacement, options, only);
    if (outcome.replaced > 0) edit((current) => replaceInPage(current, query, replacement, options, only).content, "replace");
    const kept = outcome.tooLong.length;
    setMessage(`${outcome.replaced === 0 ? ew.replacedNone : countWords(outcome.replaced, ew.replaced)}${kept > 0 ? ` ${countWords(kept, ew.tooLong)}` : ""}`);
  };

  // The custom field groups this page or article gets now (D118): they follow its categories and tags as they change.
  const fieldGroups =
    context.type === "page" || context.type === "article"
      ? applicableGroups(context.fields?.groups ?? [], {
          entity: context.type,
          categories: withParents(content.categories, terms),
          tags: content.tags,
          roles: fieldRoles,
        })
      : [];
  const pictureUpload = upload
    ? (file: File) =>
        shrinkAndUpload(file, async (image, thumbnail) => {
          const data = new FormData();
          data.set("image", image);
          data.set("name", file.name);
          data.set("thumbnail", thumbnail);
          data.set("compressed", "1");
          const outcome = await upload(data);
          return outcome.ok ? { ok: true, url: outcome.url, thumbnailUrl: null } : { ok: false, problem: outcome.problem };
        })
    : null;

  // The Theme tab keeps its own changes with Save theme; Save and Publish keep them too (D195), so nothing set there stays only on the canvas.
  const theme = useRef<{ dirty: boolean; save: () => Promise<string[] | null> }>({ dirty: false, save: async () => null });
  const [themeDirty, setThemeDirty] = useState(false);
  // Leaving with unsaved changes asks first.
  useEffect(() => {
    if (!dirty && !themeDirty) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty, themeDirty]);

  // The page checker (wave 1, 1e): what a reader, a screen reader or the checkout's policy would meet, as the page stands now. A checker that
  // throws on odd content is not allowed to stop the editor: the tab then says it is not available, and the server asks again on publish.
  const checkout = context.check?.checkoutPageId != null && saved?.id === context.check.checkoutPageId;
  const issues = useMemo<PageIssue[] | null>(() => {
    try {
      return pageIssues(content, { ...(context.check && { theme: { sets: context.check.theme } }), checkout, ...(shape === "footer" && { footer: { storeId: context.owner } }) });
    } catch {
      return null;
    }
  }, [content, context.check, checkout, shape, context.owner]);

  const submit = (publish: boolean, acknowledged?: string[]) =>
    startBusy(async () => {
      setProblems([]);
      if (theme.current.dirty) {
        const failed = await theme.current.save().catch(() => [w.theme.couldNotSave]);
        if (failed) {
          setProblems(failed);
          return;
        }
      }
      const sent = content;
      // The globals changed here (D98): the server takes them from this page to every page using them.
      const globalEdits = editedGlobals(sent, known.current);
      const fields = fieldGroups.length > 0 ? changesFrom(fieldGroups.flatMap((g) => g.fields), fieldData, context.languages.map((l) => l.locale)) : undefined;
      const outcome: PageSaveState = await actions.save(saved?.id ?? null, JSON.stringify({ ...sent, globalEdits, fields }), publish, acknowledged);
      if (outcome.status === "error") {
        // The server holds the same question as the dialog: something it found that this editor did not is asked about now.
        if (outcome.code === "needs_confirmation" && outcome.issues && outcome.issues.length > 0) setAsking(outcome.issues);
        else setProblems(outcome.problems);
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
      setMessage(publish ? fillWords(ew.publishedAt, { address: context.place ? context.place.address : `${siteBase}/${outcome.page.slug}` }) : ew.draftSaved);
      // A new page moves to its own address; the editor there says what happened.
      if (!saved) router.replace(`${adminBase}/${outcome.page.id}?saved=${publish ? "published" : "draft"}`);
    });

  // Publish: a blocking problem (the checkout page's refusals are the server's to say) is asked about first; a draft is never held back.
  const requestPublish = () => {
    const blocking = issues ? blockingIssues(issues).filter((i) => i.rule !== "pay_page_block") : [];
    if (blocking.length > 0) setAsking(blocking);
    else submit(true);
  };

  // Ctrl/Cmd + S saves the draft.
  const onKey = useEffectEvent((event: KeyboardEvent) => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
      event.preventDefault();
      if (!busy) submit(false);
      return;
    }
    // Ctrl/Cmd + Shift + H opens find and replace.
    if ((event.metaKey || event.ctrlKey) && event.shiftKey && event.key.toLowerCase() === "h") {
      event.preventDefault();
      setFindOpen(true);
      return;
    }
    // Ctrl/Cmd + Z and Shift + Z (or Ctrl + Y) undo and redo the page, except in a field or a text, which undo their own typing.
    const which = historyKey(event);
    if (!which || event.defaultPrevented) return;
    const target = event.target instanceof HTMLElement ? event.target : null;
    if (target && (target.closest("input, textarea, select, [contenteditable]:not([contenteditable='false'])") || target.closest("dialog[open]"))) return;
    event.preventDefault();
    step(which);
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
        setMessage(ew.unpublished[noun]);
      }
    });

  const remove = () =>
    startBusy(async () => {
      if (!saved) return;
      setDirty(false);
      const outcome = await actions.remove(saved.id);
      if (outcome) setProblems(outcome.problems);
    });

  // A copy as a draft (D126) of what the editor holds now, unsaved changes too; the person lands in the copy's editor.
  const duplicate = () =>
    startBusy(async () => {
      if (!saved) return;
      setProblems([]);
      const outcome = await actions.duplicate(saved.id, JSON.stringify(content));
      if (!outcome.ok) {
        setProblems(outcome.problems);
        return;
      }
      // The original keeps its own unsaved changes: leaving for the copy must not ask about them.
      setDirty(false);
      router.push(`${adminBase}/${outcome.id}`);
    });

  // The owner's saved parts changed (one saved, changed or deleted): a global changed or deleted under Saved (the server
  // has changed the pages using it) reaches this page's uses of it at once.
  const updateParts = (next: SavedPart[]) => {
    const before = new Map(parts.map((p) => [p.id, p]));
    const globals = globalsOf(next);
    const changed = new Map([...globals].filter(([id]) => before.get(id)?.global && before.get(id)?.updatedAt !== next.find((p) => p.id === id)?.updatedAt));
    const gone = new Set([...known.current.keys()].filter((id) => !globals.has(id)));
    known.current = globals;
    setParts(next);
    if (changed.size > 0 || gone.size > 0) setContent((current) => refreshUses(current, changed, (id) => gone.has(id)));
  };

  const liveSlug = saved?.published ? saved.slug : null;
  const moving = liveSlug !== null && content.slug !== liveSlug && pageSlugProblem(content.slug, reserved) === null;
  const excerpt = pageExcerpt(view);
  // "A/B test this" (D148): a test is of the page as it is published, so changes not yet published come first. The new-test form takes the part.
  const testPart = (target: { kind: "row" | "column" | "block"; id: string }) => {
    if (!saved || !context.experimentsHref) return;
    if (dirty || saved.state === "changed") {
      setProblems([ew.publishFirst]);
      return;
    }
    router.push(`${context.experimentsHref}?page=${saved.id}&kind=${target.kind}&part=${encodeURIComponent(target.id)}`);
  };

  const state: PageState | null = saved ? (dirty && saved.published ? "changed" : saved.state) : null;

  return (
    // Every colour field offers the theme's colours (D180).
    <ColourSwatches value={context.colours}>
    <MediaPickerProvider list={context.media}>
    {/* Every picture field can make its picture by prompt in the site's look (D283) where the site's AI has a picture model. */}
    <PictureMakerProvider maker={context.pictures}>
    <SignupCodesContext value={context.signupCodes ?? null}>
    {/* The store's saved colours and gradients (D183), kept on its theme; none on Kaizen's own pages. */}
    <ColourLibraryProvider
      initial={context.theme?.settings?.library}
      save={
        context.actions.saveLibrary
          ? async (library) => {
              const result = await context.actions.saveLibrary!(JSON.stringify(library));
              return result.ok ? null : result.problems;
            }
          : null
      }
    >
    {/* Full width (see `AdminMain`): a left sidebar, the content and a right sidebar, a quarter, a half and a quarter. */}
    <div className={`flex flex-col gap-6 pb-28 ${problems.length > 0 ? "" : "lg:pb-0"}`}>
      <PageBuilder
        // A new language starts with its dialogs closed.
        key={locale}
        lang={language.locale.split("-")[0]}
        rows={view.rows}
        onRows={changeRows}
        translate={translating ? { name: language.name, mainName: main.name, source: content.rows } : null}
        css={[siteCss, content.css ?? ""]}
        saved={parts}
        onSaved={updateParts}
        templates={context.templates}
        // A signature theme's own sections (D272), not while translating: a section is placed in the page's main language.
        themeSections={translating ? null : (context.themeSections ?? null)}
        pageType={context.type}
        motionRequest={motionRequest}
        pageCss={content.css ?? ""}
        onPageCss={(css) => changeCss(css ?? "")}
        productParts={shape === "product_layout"}
        fieldGroups={context.fields?.groups ?? null}
        onTestPart={context.experimentsHref && saved?.published ? testPart : undefined}
        checks={
          issues
            ? { count: issues.length, panel: <PageIssuesPanel issues={issues} /> }
            : { count: 0, panel: <p className="text-sm text-muted">{ew.checksUnavailable}</p> }
        }
        shopParts={shape === "page" && context.owner !== null}
        siteParts={shape === "header" || shape === "footer" ? sitePartsFor(context.owner) : null}
        upload={upload}
        startVideo={context.startVideo}
        fonts={{ ...context.fonts, install: context.actions.installFont, theme: context.theme }}
        // The Theme tab (D182): a store's own pages only.
        onThemeState={(state) => {
          theme.current = state;
          setThemeDirty(state.dirty);
        }}
        themeTab={context.theme?.settings && context.actions.saveThemeTab ? { settings: context.theme.settings, save: context.actions.saveThemeTab } : null}
        grid={{
          pageId: saved?.id ?? null,
          owner: context.owner,
          pageTerms: context.type === "page" ? terms : (gridTerms.page ?? []),
          pageChoices: context.parents ?? [],
          articleTerms: context.type === "article" ? terms : (gridTerms.article ?? []),
          stores: context.gridStores,
          menus: context.menus,
          menusHref: context.menusHref,
          plans: context.plans,
          themeStore: context.themeStore ?? null,
          features: context.features ?? null,
          shape,
          contentTypes: context.contentTypes ?? [],
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
            <section aria-label={layout ? ew.name : ew.titleAndAddress} className={card}>
              <label className={label}>
                {layout ? ew.nameOf[noun] : translating ? fillWords(ew.titleIn, { lang: language.name }) : ew.title}
                <input
                  value={view.title}
                  maxLength={PAGE_TITLE_MAX}
                  onChange={(event) => {
                    const title = event.target.value;
                    // The address is one for all languages, made from the main title.
                    change(
                      slugFollows && !translating
                        ? { title, slug: slugFromTitle(title, content.slug) }
                        : { title },
                    );
                  }}
                  placeholder={
                    context.type === "article"
                      ? ew.placeholders.article
                      : context.type === "header"
                        ? ew.placeholders.header
                        : context.type === "footer"
                          ? ew.placeholders.footer
                          : layout
                            ? ew.placeholders.layout
                            : ew.placeholders.page
                  }
                  className={`${input} min-h-12 text-xl font-medium`}
                />
              </label>
              {layout ? (
                <p className={hint}>
                  {context.type === "product_layout"
                    ? ew.layoutHint
                    : context.type === "variant"
                      ? ew.versionHint[shape === "product_layout" ? "product_layout" : shape === "header" ? "header" : shape === "footer" ? "footer" : "page"]
                      : ew.siteLayoutHint[context.type === "footer" ? "footer" : "header"]}
                </p>
              ) : translating ? (
                <p className={hint}>{fillWords(ew.addressSame, { slug: content.slug, main: main.name })}</p>
              ) : context.place ? (
                <p className={hint}>{fillWords(ew.placeHint, { address: context.place.address })}</p>
              ) : (
              <SlugField
                slug={content.slug}
                follows={slugFollows}
                origin={origin}
                siteBase={siteBase}
                reserved={reserved}
                parents={context.type === "page" ? (context.parents ?? []) : []}
                own={saved?.slug ?? null}
                onChange={(slug) => {
                  setSlugFollows(false);
                  change({ slug });
                }}
                onFollow={() => {
                  setSlugFollows(!liveSlug);
                  change({ slug: slugFromTitle(content.title, content.slug) });
                }}
              />
              )}
              {moving && !translating && !layout && !context.place && (
                <p className="rounded-md bg-sunken p-3 text-sm">
                  {ew.movingBefore} <strong>{siteBase}/{liveSlug}</strong> {ew.movingMiddle} <strong>{siteBase}/{content.slug}</strong> {ew.movingAfter}
                </p>
              )}
            </section>
            {!translating && context.type === "footer" && (
              <section className="flex flex-col gap-3 rounded-panel border border-line bg-card p-4">
                <h2 className="text-title text-ink">{ew.reveal}</h2>
                <label className="flex items-start gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={Boolean(content.footerReveal)}
                    onChange={(event) => change({ footerReveal: event.target.checked || undefined })}
                    className="mt-0.5 size-4"
                  />
                  <span>
                    {ew.fixedFooter}
                    <span className="block text-xs text-muted">{ew.fixedFooterHint}</span>
                  </span>
                </label>
              </section>
            )}
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
                <h2 id="author-heading" className="text-title text-ink">
                  {ew.author}
                </h2>
                <div className="flex flex-col gap-1">
                  <label className={label}>
                    {ew.writtenBy}
                    <input
                      value={content.author ?? ""}
                      maxLength={AUTHOR_MAX}
                      onChange={(event) => change({ author: event.target.value })}
                      placeholder={ew.name}
                      aria-describedby="author-hint"
                      className={input}
                    />
                  </label>
                  <span id="author-hint" className={hint}>
                    {context.owner === null ? ew.authorHintKaizen : ew.authorHint}
                  </span>
                </div>
              </section>
            )}
            {!context.place && (
              <section aria-labelledby="terms-heading" className={card}>
                <h2 id="terms-heading" className="text-title text-ink">
                  {ew.terms}
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
            )}
            <EntityFields
              groups={fieldGroups}
              data={fieldData}
              onChange={(next) => {
                setFieldData(next);
                setDirty(true);
                setMessage(null);
              }}
              locales={context.languages.map((l) => l.locale)}
              main={main.locale}
              languageNames={Object.fromEntries(context.languages.map((l) => [l.locale, l.name]))}
              upload={pictureUpload}
              fileUpload={context.fields?.startFile ? fieldFileUploader(context.fields.startFile) : null}
              lookups={context.fields?.lookups ?? EMPTY_LOOKUPS}
              locale={locale}
            />
            <ThumbnailField
              value={content.thumbnail}
              upload={upload}
              onChange={(thumbnail) => change({ thumbnail })}
            />
            <section aria-labelledby="visibility-heading" className={card}>
              <h2 id="visibility-heading" className="text-title text-ink">
                {ew.whoMayRead}
              </h2>
              <Switch
                checked={content.searchEngines}
                onChange={(searchEngines) => change({ searchEngines })}
                title={ew.searchEngines}
                help={ew.searchEnginesHint}
              />
              <Switch
                checked={content.aiAssistants}
                onChange={(aiAssistants) => change({ aiAssistants })}
                title={ew.aiAssistants}
                help={ew.aiAssistantsHint}
              />
            </section>
            </>
            )}
            {translating && view.thumbnail && (
              <section aria-labelledby="thumbnail-alt-heading" className={card}>
                <h2 id="thumbnail-alt-heading" className="text-title text-ink">
                  {ew.picture}
                </h2>
                <label className={label}>
                  {fillWords(w.translate.altIn, { lang: language.name })}
                  <textarea
                    value={view.thumbnail.alt}
                    maxLength={ALT_MAX}
                    rows={2}
                    onChange={(event) => view.thumbnail && change({ thumbnail: { ...view.thumbnail, alt: event.target.value } })}
                    className={`${input} py-2`}
                  />
                  <span className={hint}>{fillWords(ew.inMainAlt, { main: main.name, alt: content.thumbnail?.alt || ew.noDescription })}</span>
                </label>
              </section>
            )}
            {!layout && (
            <section aria-labelledby="excerpt-heading" className={card}>
              <h2 id="excerpt-heading" className="text-title text-ink">
                {ew.excerpt}
              </h2>
              <label className={label}>
                {ew.excerptLabel}
                <textarea
                  value={view.excerpt ?? ""}
                  maxLength={EXCERPT_FIELD_MAX}
                  rows={3}
                  onChange={(event) => change({ excerpt: event.target.value || undefined })}
                  className={`${input} py-2`}
                />
                <span className={hint}>{ew.excerptHint}</span>
              </label>
            </section>
            )}
            {!layout && (
            <section aria-labelledby="search-heading" className={card}>
              <h2 id="search-heading" className="text-title text-ink">
                {ew.searchSharing}
              </h2>
              <SearchSnippetFields
                value={view.seo}
                onChange={(seo) => change({ seo })}
                fallback={{
                  title: view.title || ew.titleOf[noun],
                  description: excerpt || defaultDescription,
                }}
                url={`${origin}${siteBase}/${content.slug}`}
                lang={language.locale}
              />
              <p className={hint}>{ew.searchHint}</p>
            </section>
            )}
          </>
        }
      />

      {problems.length > 0 && (
        <div role="alert" className="rounded-lg border border-danger-text p-4 text-sm">
          <p className="font-medium">{ew.notSavedFix}</p>
          <ul className="mt-2 list-disc pl-5">
            {problems.map((problem) => (
              <li key={problem}>{problem}</li>
            ))}
          </ul>
        </div>
      )}

      <SaveTemplateDialog
        open={templateOpen}
        create={actions.createPart}
        layout={layoutOf(content, context.type)}
        defaultName={defaultTemplateName(content.title)}
        // Kaizen's own parts are always the marketplace's (D125): nothing to choose there.
        canShare={context.templates !== null && context.templates.previewStore !== null}
        onClose={() => setTemplateOpen(false)}
        onSaved={(next) => {
          updateParts(next);
          setMessage(w.templates.savedAsTemplate);
        }}
      />

      <CssPanel
        open={cssOpen}
        onClose={() => setCssOpen(false)}
        noun={noun}
        siteName={context.owner === null ? ew.kaizenSite : ew.yourStore}
        pageCss={content.css ?? ""}
        onPageCss={changeCss}
        siteCss={siteCss}
        onSiteCss={setSiteCss}
        saveSiteCss={actions.saveSiteCss}
      />

      <FindReplaceDialog open={findOpen} onClose={() => setFindOpen(false)} content={view} onReplace={replaceWords} />

      {saved && actions.versions && (
        <PageVersionsDialog
          open={versionsOpen}
          onClose={() => setVersionsOpen(false)}
          list={() => actions.versions!.list(saved.id)}
          read={(version) => actions.versions!.read(saved.id, version)}
          onUse={takeVersion}
        />
      )}

      {asking && (
        <PublishWithIssuesDialog
          issues={asking}
          busy={busy}
          onFixFirst={() => setAsking(null)}
          onPublishAnyway={() => {
            const seen = asking.map(issueId);
            setAsking(null);
            submit(true, seen);
          }}
        />
      )}

      <div data-editor-bar="" className="fixed inset-x-0 bottom-0 z-20 border-t border-line bg-card/95 backdrop-blur">
        <div className="flex flex-wrap items-center gap-2 px-4 py-3">
          {context.draftOnly ? (
            // A design profile's workspace (D177): every save is the profile's draft, published with the profile from its own page.
            <button
              type="button"
              onClick={() => submit(false)}
              disabled={busy}
              className="min-h-11 rounded-pill bg-brand px-5 font-medium text-brand-ink disabled:opacity-50"
            >
              {busy ? w.savedPart.saving : w.savedPart.save}
            </button>
          ) : (
            <>
              <button
                type="button"
                onClick={() => submit(false)}
                disabled={busy}
                className="min-h-11 rounded-pill border border-edge px-4 font-medium disabled:opacity-50"
              >
                {ew.saveDraft}
              </button>
              <button
                type="button"
                onClick={requestPublish}
                disabled={busy}
                className="min-h-11 rounded-pill bg-brand px-5 font-medium text-brand-ink disabled:opacity-50"
              >
                {busy ? w.savedPart.saving : saved?.published ? ew.publishChanges : ew.publish}
              </button>
            </>
          )}
          <div className="flex items-center" role="group" aria-label={ew.undoRedo}>
            <button
              type="button"
              onClick={() => step("undo")}
              disabled={history.past.length === 0}
              aria-label={ew.undo}
              title={ew.undoKey}
              className="flex size-11 items-center justify-center rounded-pill hover:bg-sunken disabled:opacity-40"
            >
              <Undo2 aria-hidden className="size-5" />
            </button>
            <button
              type="button"
              onClick={() => step("redo")}
              disabled={history.future.length === 0}
              aria-label={ew.redo}
              title={ew.redoKey}
              className="flex size-11 items-center justify-center rounded-pill hover:bg-sunken disabled:opacity-40"
            >
              <Redo2 aria-hidden className="size-5" />
            </button>
          </div>
          <button
            type="button"
            onClick={() => setFindOpen(true)}
            aria-haspopup="dialog"
            aria-label={ew.findReplace}
            title={ew.findReplaceKey}
            className="flex size-11 items-center justify-center rounded-pill hover:bg-sunken"
          >
            <Replace aria-hidden className="size-5" />
          </button>
          <p role="status" aria-live="polite" className="text-sm">
            {message ?? (dirty ? ew.unsaved : context.draftOnly ? (saved ? ew.savedInProfile : ew.notSavedYet) : state ? ew.states[state] : ew.notSavedYet)}
            {/* One undo, only while nothing else has been changed since. */}
            {coolUndo && coolUndo.after === content.rows && (
              <button type="button" onClick={undoCool} className="ml-2 underline">
                {ew.undo}
              </button>
            )}
          </p>
          {!translating && (
            <button
              type="button"
              onClick={() => setCoolOpen(true)}
              aria-label={w.cool.label}
              title={w.cool.label}
              className="flex size-11 items-center justify-center rounded-pill border border-edge hover:bg-sunken"
            >
              <WandSparkles aria-hidden className="size-5" />
            </button>
          )}
          <MakeCoolDialog
            open={coolOpen}
            onClose={() => setCoolOpen(false)}
            run={() => actions.motion(JSON.stringify(content.rows))}
            onApply={applyCool}
          />
          <button
            type="button"
            onClick={() => setCssOpen((open) => !open)}
            aria-expanded={cssOpen}
            aria-controls="css-panel"
            className="flex min-h-11 items-center gap-2 rounded-pill border border-edge px-4 text-sm font-medium hover:bg-sunken"
          >
            <span aria-hidden className="font-mono">{"{ }"}</span>
            {ew.customCss}
            {(content.css || siteCss.trim()) && <span className="size-2 rounded-full bg-insight-solid" title={ew.hasCss} />}
          </button>
          {context.draftOnly ? (
            <div className="ml-auto flex flex-wrap items-center gap-3 text-sm">
              <span className="text-muted">{context.draftOnly.note}</span>
              <a href={context.draftOnly.preview} target="_blank" rel="noopener" className="underline">
                {ew.previewTheDraft}{dirty ? ` ${ew.lastSaved}` : ""}
              </a>
            </div>
          ) : (
          <div className="ml-auto flex flex-wrap items-center gap-3 text-sm">
            {saved && (
              <a href={`${adminBase}/${saved.id}/preview`} target="_blank" rel="noopener" className="underline">
                {ew.previewDraft}{dirty ? ` ${ew.lastSaved}` : ""}
              </a>
            )}
            {context.place
              ? liveSlug &&
                context.place.view && (
                  <a href={context.place.view} target="_blank" rel="noopener" className="underline">
                    {ew.view[noun]}
                  </a>
                )
              : liveSlug &&
                !layout && (
                  <a href={`${siteBase}/${liveSlug}`} target="_blank" rel="noopener" className="underline">
                    {ew.view[noun]}
                  </a>
                )}
            {saved && actions.versions && (
              <button type="button" onClick={() => setVersionsOpen(true)} aria-haspopup="dialog" className="flex items-center gap-1 underline">
                <History aria-hidden className="size-4" />
                {ew.versions}
              </button>
            )}
            {!isVersion && !context.place && (
              <button
                type="button"
                onClick={() => setTemplateOpen(true)}
                aria-haspopup="dialog"
                className="underline"
              >
                {ew.saveAsTemplate}
              </button>
            )}
            {saved && !isVersion && !context.place && (
              <button type="button" onClick={duplicate} disabled={busy} className="underline disabled:opacity-50">
                {w.tools.duplicate}
              </button>
            )}
            {saved?.published && !isVersion && (
              <button type="button" onClick={unpublish} disabled={busy} className="underline disabled:opacity-50">
                {ew.unpublish}
              </button>
            )}
            {saved &&
              !isVersion &&
              (confirmDelete ? (
                <span className="flex items-center gap-2">
                  {ew.deleteForGood}
                  <button
                    type="button"
                    onClick={remove}
                    disabled={busy}
                    className="min-h-9 rounded-pill bg-danger-soft px-3 text-danger-text disabled:opacity-50"
                  >
                    {ew.deleteThis[noun]}
                  </button>
                  <button type="button" onClick={() => setConfirmDelete(false)} className="underline">
                    {w.dialogs.keepIt}
                  </button>
                </span>
              ) : (
                <button type="button" onClick={() => setConfirmDelete(true)} className="text-danger-text underline">
                  {w.tools.delete}
                </button>
              ))}
          </div>
          )}
        </div>
      </div>
    </div>
    </ColourLibraryProvider>
    </SignupCodesContext>
    </PictureMakerProvider>
    </MediaPickerProvider>
    </ColourSwatches>
  );
}

function SlugField({
  slug,
  follows,
  origin,
  siteBase,
  reserved,
  parents,
  own,
  onChange,
  onFollow,
}: {
  slug: string;
  /** The owner's pages this one can be nested under (`projects`), and this page's own saved address, which it cannot be nested under. */
  parents: readonly { slug: string; title: string }[];
  own: string | null;
  follows: boolean;
  origin: string;
  siteBase: string;
  reserved: readonly string[];
  onChange: (slug: string) => void;
  onFollow: () => void;
}) {
  const id = useId();
  const sw = useAdminText("builder").editor.slug;
  const problem = slug ? pageSlugProblem(slug, reserved) : null;
  const parent = pageParentPath(slug);
  // Not under itself or a page nested under it; a parent that has since been deleted stays chosen until it is changed.
  const choices = parents.filter((p) => own === null || (p.slug !== own && !p.slug.startsWith(`${own}/`)));
  const known = parent === "" || choices.some((p) => p.slug === parent);
  const parentId = `${id}-parent`;
  return (
    <div className="flex flex-col gap-1">
      {(choices.length > 0 || parent !== "") && (
        <div className="mb-1 flex flex-col gap-1">
          <label htmlFor={parentId} className="text-sm font-medium">
            {sw.parent}
          </label>
          <select
            id={parentId}
            value={parent}
            onChange={(event) => onChange(joinPagePath(event.target.value, pageSegment(slug)))}
            className="min-h-10 rounded-md border border-line bg-transparent px-2 text-sm"
          >
            <option value="">{sw.none}</option>
            {!known && <option value={parent}>/{parent}</option>}
            {choices.map((p) => (
              <option key={p.slug} value={p.slug}>
                {p.title} (/{p.slug})
              </option>
            ))}
          </select>
        </div>
      )}
      <label htmlFor={id} className="text-sm font-medium">
        {sw.address}
      </label>
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex min-w-0 flex-1 items-center rounded-md border border-line focus-within:outline-2">
          <span aria-hidden className="shrink-0 pl-3 text-sm text-muted">
            /{parent ? `${parent}/` : ""}
          </span>
          <input
            id={id}
            value={pageSegment(slug)}
            maxLength={PAGE_SLUG_MAX}
            onChange={(event) => onChange(joinPagePath(parent, event.target.value.toLowerCase().replace(/[\s/]+/g, "-")))}
            spellCheck={false}
            aria-invalid={problem ? true : undefined}
            aria-describedby={`${id}-hint`}
            className="min-h-10 min-w-0 flex-1 bg-transparent pr-3 text-sm outline-none"
          />
        </div>
        {!follows && (
          <button type="button" onClick={onFollow} className={small}>
            {sw.fromTitle}
          </button>
        )}
      </div>
      <span id={`${id}-hint`} className={problem ? "text-xs text-danger-text" : hint}>
        {problem ?? (
          <>
            <span className="block break-all text-ink">
              {origin.replace(/^https?:\/\//, "")}
              {siteBase}/{slug}
            </span>
            {follows ? sw.follows : sw.rule}
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
  const sw = useAdminText("builder").editor.switch;
  return (
    <div className="flex items-start gap-3">
      <input
        id={id}
        type="checkbox"
        role="switch"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        aria-describedby={`${id}-help`}
        className="mt-0.5 size-5 shrink-0 accent-brand"
      />
      <div className="flex flex-col gap-0.5">
        <label htmlFor={id} className="text-sm font-medium">
          {fillWords(checked ? sw.welcome : sw.keptOut, { title })}
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
  const tw = useAdminText("builder").editor.thumb;

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
      // Compressed until it was as small as it could be while it looked the same (D213).
      data.set("compressed", "1");
      const outcome = await upload(data);
      if (outcome.ok) onChange({ url: outcome.url, width: size.width, height: size.height, alt: value?.alt ?? "" });
      else setProblem(outcome.problem);
      size.close();
    } catch {
      setProblem(fillWords(tw.unreadable, { name: file.name }));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section aria-labelledby="thumbnail-heading" className={card}>
      <div>
        <h2 id="thumbnail-heading" className="text-title text-ink">
          {tw.title}
        </h2>
        <p className="text-sm text-muted">{tw.intro}</p>
      </div>
      {value ? (
        // eslint-disable-next-line @next/next/no-img-element -- admin preview of the uploaded picture
        <img src={value.url} alt="" className="aspect-[1200/630] w-full rounded-md border border-line object-cover" />
      ) : (
        <div className="flex aspect-[1200/630] w-full items-center justify-center rounded-md border border-dashed border-line bg-sunken text-sm text-muted">
          {tw.none}
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2 text-sm">
        {upload ? (
          <label className="cursor-pointer rounded-md border border-line px-3 py-2 focus-within:outline-2">
            {busy ? tw.uploading : value ? tw.replace : tw.upload}
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
          <p className="text-muted">{tw.noUploads}</p>
        )}
        <LibraryButton onPicked={(picture) => onChange({ url: picture.url, width: picture.width, height: picture.height, alt: value?.alt || picture.alt })} />
        {value && (
          <button type="button" onClick={() => onChange(null)} className="rounded-pill px-3 py-2 underline">
            {tw.remove}
          </button>
        )}
      </div>
      {value && (
        <label className={label}>
          {tw.alt}
          <textarea
            value={value.alt}
            maxLength={ALT_MAX}
            rows={2}
            onChange={(event) => onChange({ ...value, alt: event.target.value })}
            placeholder={tw.altPlaceholder}
            className={`${input} py-2`}
          />
          <span className={hint}>{tw.altHint}</span>
        </label>
      )}
      {problem && (
        <p role="alert" className="text-sm text-danger-text">
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
  const lw = useAdminText("builder").editor.language;
  return (
    <section aria-labelledby="language-heading" className={card}>
      <h2 id="language-heading" className="text-title text-ink">
        {lw.title}
      </h2>
      <div role="radiogroup" aria-labelledby="language-heading" className="flex flex-wrap gap-2">
        {languages.map((language) => {
          const done = language === main ? null : progress(language.locale);
          return (
            <label
              key={language.locale}
              className="relative flex cursor-pointer flex-col rounded-pill border border-edge px-3 py-1.5 text-sm has-checked:border-brand has-checked:bg-inverse has-checked:text-inverse-ink has-focus-visible:outline-2"
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
              <span className="text-xs opacity-80">{done ? fillWords(lw.progress, { done: done.done, of: done.of }) : lw.main}</span>
            </label>
          );
        })}
      </div>
      <p className={hint}>{fillWords(lw.hint, { main: main.name, others: others.map((l) => l.name).join(", ") })}</p>
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
  const aw = useAdminText("builder").editor.ai;
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
        lines.push(fillWords(aw.translated, { lang: language.name, done, of: items.length }));
        for (const skipped of outcome.skipped.slice(0, 5)) lines.push(fillWords(aw.leftIn, { main: main.name, label: skipped.label, reason: skipped.reason }));
        if (outcome.skipped.length > 5) lines.push(fillWords(aw.more, { n: outcome.skipped.length - 5, main: main.name }));
      }
      setResult({ ok, lines });
      if (ok && targets.length === 1 && first) onShow(first.locale);
    });

  return (
    <section aria-labelledby="translate-ai-heading" className={card}>
      <h2 id="translate-ai-heading" className="text-title text-ink">
        {aw.title}
      </h2>
      <label className={label}>
        {aw.into}
        <select value={target} onChange={(event) => setTarget(event.target.value)} disabled={busy} className={input}>
          {others.length > 1 && <option value="all">{aw.allOthers}</option>}
          {others.map((language) => (
            <option key={language.locale} value={language.locale}>
              {language.name}
            </option>
          ))}
        </select>
      </label>
      <div role="radiogroup" aria-label={aw.which} className="flex flex-col gap-2 text-sm">
        <label className="flex items-start gap-2">
          <input type="radio" name="translate-mode" checked={mode === "missing"} onChange={() => setMode("missing")} disabled={busy} className="mt-1" />
          <span>{aw.missing}</span>
        </label>
        <label className="flex items-start gap-2">
          <input type="radio" name="translate-mode" checked={mode === "all"} onChange={() => setMode("all")} disabled={busy} className="mt-1" />
          <span>{aw.everything}</span>
        </label>
      </div>
      <button type="button" onClick={run} disabled={busy || total === 0} className={small}>
        {busy ? aw.translating : total === 0 ? aw.nothing : countWords(total, aw.translate)}
      </button>
      <div role="status" aria-live="polite" className="flex flex-col gap-1 text-xs">
        {result?.lines.map((line, index) => (
          <p key={index} className={result.ok ? "text-muted" : "text-danger-text"}>
            {line}
          </p>
        ))}
        {result?.ok && <p className="text-muted">{aw.readOver}</p>}
      </div>
      <p className={hint}>{fillWords(aw.hint, { main: main.name })}</p>
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
  const ow = useAdminText("builder").editor.overlay;
  const where = value?.where ?? "none";
  const choices = [
    { value: "none", label: ow.none },
    { value: "everywhere", label: ow.everywhere },
    ...(kaizen ? [] : [{ value: "front", label: ow.front }]),
    { value: "terms", label: ow.terms },
  ] as const;
  const set = (next: string) =>
    onChange(
      next === "none"
        ? undefined
        : { where: next as HeaderOverlay["where"], categories: value?.categories ?? [], tags: value?.tags ?? [], textColor: value?.textColor },
    );
  return (
    <section aria-labelledby={`${id}-heading`} className="flex flex-col gap-3 rounded-panel border border-line bg-card p-4">
      <h2 id={`${id}-heading`} className="text-title text-ink">
        {ow.title}
      </h2>
      <p className="text-xs text-muted">{ow.intro}</p>
      <fieldset className="flex flex-col gap-2">
        <legend className="sr-only">{ow.where}</legend>
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
            {ow.ownColour}
          </label>
          {value.textColor && <ColorField label={ow.textColour} value={value.textColor} onChange={(textColor) => onChange({ ...value, textColor })} />}
          <p className="text-xs text-muted">{ow.white}</p>
        </div>
      )}
    </section>
  );
}
