"use client";

import { useRouter } from "next/navigation";
import { useEffect, useEffectEvent, useId, useState, useTransition } from "react";

import {
  createPageTermAction,
  deletePageAction,
  savePageAction,
  unpublishPageAction,
  type PageSaveState,
} from "@/app/admin/(gated)/platform/pages/actions";
import { SearchSnippetFields } from "@/components/admin/seo-fields";
import { TermPicker } from "@/components/admin/terms";
import { shrinkImage } from "@/lib/image-resize";
import {
  ALT_MAX,
  PAGE_SLUG_MAX,
  PAGE_TITLE_MAX,
  newPageContent,
  pageExcerpt,
  pageSlugFromTitle,
  pageSlugProblem,
  type PageContent,
  type PageRow,
  type PageThumbnail,
} from "@/lib/page-content";
import { newBlock, newRow } from "@/lib/page-rows";
import type { SavedPart } from "@/lib/saved-parts";
import type { Term } from "@/lib/taxonomy";
import type { EditablePage, PageState } from "@/server/pages";

import { newId, PageBuilder } from "./page-builder";

type Upload = (data: FormData) => Promise<{ ok: true; url: string } | { ok: false; problem: string }>;

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
function startingRows(): PageRow[] {
  const row = newRow("1", newId);
  row.columns[0].blocks.push(newBlock("richText", newId));
  return [row];
}

/**
 * One of Kaizen's pages (D42), held whole in the browser: title, address,
 * picture, search texts, who may read it, and its content: rows of
 * columns of blocks, built in `PageBuilder` (D43). Save keeps a draft;
 * Publish puts the page on the site.
 */
export function PageEditor({
  page,
  notice = null,
  origin,
  defaultDescription,
  savedParts,
  upload,
  terms: initialTerms,
}: {
  page: EditablePage | null;
  /** Said when the editor opens, such as "Draft saved." after a new page's first save. */
  notice?: string | null;
  origin: string;
  /** Kaizen's own description, the last fallback for a page without text. */
  defaultDescription: string;
  /** Saved rows, columns and components, for the builder's Saved tab (D46). */
  savedParts: SavedPart[];
  upload: Upload | null;
  /** Kaizen's page categories and tags (D50). */
  terms: Term[];
}) {
  const [terms, setTerms] = useState(initialTerms);
  const router = useRouter();
  const [saved, setSaved] = useState<EditablePage | null>(page);
  const [content, setContent] = useState<PageContent>(
    page?.draft ?? { ...newPageContent(), rows: startingRows() },
  );
  // The address follows the title until it is edited, and never once the page is live.
  const [slugFollows, setSlugFollows] = useState(
    !page || (!page.published && page.draft.slug === pageSlugFromTitle(page.draft.title)),
  );
  const [dirty, setDirty] = useState(false);
  const [problems, setProblems] = useState<string[]>([]);
  const [message, setMessage] = useState<string | null>(notice);
  const [busy, startBusy] = useTransition();
  const [confirmDelete, setConfirmDelete] = useState(false);

  const change = (next: Partial<PageContent>) => {
    setContent((current) => ({ ...current, ...next }));
    setDirty(true);
    setMessage(null);
  };
  // Rows change by function: a text block's editor reports from an earlier render.
  const changeRows = (update: (rows: PageRow[]) => PageRow[]) => {
    setContent((current) => ({ ...current, rows: update(current.rows) }));
    setDirty(true);
    setMessage(null);
  };

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
      const outcome: PageSaveState = await savePageAction(saved?.id ?? null, JSON.stringify(content), publish);
      if (outcome.status === "error") {
        setProblems(outcome.problems);
        return;
      }
      setDirty(false);
      setSaved(outcome.page);
      setMessage(publish ? `Published at /${outcome.page.slug}.` : "Draft saved.");
      // A new page moves to its own address; the editor there says what happened.
      if (!saved) router.replace(`/admin/platform/pages/${outcome.page.id}?saved=${publish ? "published" : "draft"}`);
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
      const outcome = await unpublishPageAction(saved.id);
      if (outcome.status === "error") setProblems(outcome.problems);
      else {
        setSaved(outcome.page);
        setMessage("Taken off the site. The page is a draft again.");
      }
    });

  const remove = () =>
    startBusy(async () => {
      if (!saved) return;
      setDirty(false);
      const outcome = await deletePageAction(saved.id);
      if (outcome) setProblems(outcome.problems);
    });

  const liveSlug = saved?.published ? saved.slug : null;
  const moving = liveSlug !== null && content.slug !== liveSlug && pageSlugProblem(content.slug) === null;
  const excerpt = pageExcerpt(content);
  const state: PageState | null = saved ? (dirty && saved.published ? "changed" : saved.state) : null;

  return (
    // Full width (see `PlatformMain`): a left sidebar, the content and a right sidebar, a quarter, a half and a quarter.
    <div className="flex flex-col gap-6 pb-28">
      <PageBuilder
        rows={content.rows}
        onRows={changeRows}
        saved={savedParts}
        upload={upload}
        aside={
          <>
            <section aria-label="Title and address" className={card}>
              <label className={label}>
                Title
                <input
                  value={content.title}
                  maxLength={PAGE_TITLE_MAX}
                  onChange={(event) => {
                    const title = event.target.value;
                    change(slugFollows ? { title, slug: pageSlugFromTitle(title) } : { title });
                  }}
                  placeholder="About Kaizen"
                  className={`${input} min-h-12 text-xl font-semibold`}
                />
              </label>
              <SlugField
                slug={content.slug}
                follows={slugFollows}
                origin={origin}
                onChange={(slug) => {
                  setSlugFollows(false);
                  change({ slug });
                }}
                onFollow={() => {
                  setSlugFollows(!liveSlug);
                  change({ slug: pageSlugFromTitle(content.title) });
                }}
              />
              {moving && (
                <p className="rounded-md bg-surface p-3 text-sm">
                  When you publish, <strong>/{liveSlug}</strong> will lead to <strong>/{content.slug}</strong> for good
                  (a permanent redirect), so links and search results keep working.
                </p>
              )}
            </section>
            <section aria-labelledby="terms-heading" className={card}>
              <h2 id="terms-heading" className="font-medium">
                Categories and tags
              </h2>
              <TermPicker
                terms={terms}
                value={{ categories: content.categories, tags: content.tags }}
                onChange={(ids) => change(ids)}
                onTerms={setTerms}
                create={createPageTermAction}
                manageHref="/admin/platform/pages/categories"
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
            <section aria-labelledby="search-heading" className={card}>
              <h2 id="search-heading" className="font-medium">
                Search and sharing
              </h2>
              <SearchSnippetFields
                value={content.seo}
                onChange={(seo) => change({ seo })}
                fallback={{
                  title: content.title || "The page's title",
                  description: excerpt || defaultDescription,
                }}
                url={`${origin}/${content.slug}`}
                lang="en"
              />
              <p className={hint}>
                Empty fields use the title and the start of the text. When shared, the page shows its picture.
              </p>
            </section>
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
          <div className="ml-auto flex flex-wrap items-center gap-3 text-sm">
            {saved && (
              <a href={`/admin/platform/pages/${saved.id}/preview`} target="_blank" rel="noopener" className="underline">
                Preview draft{dirty ? " (last saved)" : ""}
              </a>
            )}
            {liveSlug && (
              <a href={`/${liveSlug}`} target="_blank" rel="noopener" className="underline">
                View page
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
                    Delete page
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
  onChange,
  onFollow,
}: {
  slug: string;
  follows: boolean;
  origin: string;
  onChange: (slug: string) => void;
  onFollow: () => void;
}) {
  const id = useId();
  const problem = slug ? pageSlugProblem(slug) : null;
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
              {origin.replace(/^https?:\/\//, "")}/{slug}
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
      data.set("thumbnail", new File([thumbnail], `page-480.${ext}`, { type: thumbnail.type }));
      const outcome = await upload(data);
      if (outcome.ok) onChange({ url: outcome.url, width: size.width, height: size.height, alt: value?.alt ?? "" });
      else setProblem(outcome.problem);
      size.close();
    } catch {
      setProblem(`${file.name} could not be read as a picture. Use a JPEG, PNG or WebP.`);
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
