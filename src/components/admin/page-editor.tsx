"use client";

import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useRouter } from "next/navigation";
import { useEffect, useEffectEvent, useId, useState, useTransition } from "react";

import {
  deletePageAction,
  savePageAction,
  unpublishPageAction,
  type PageSaveState,
} from "@/app/admin/(gated)/platform/pages/actions";
import { SearchSnippetFields } from "@/components/admin/seo-fields";
import { shrinkImage } from "@/lib/image-resize";
import {
  ALT_MAX,
  BLOCKS_MAX,
  EMPTY_DOC,
  PAGE_SLUG_MAX,
  PAGE_TITLE_MAX,
  pageExcerpt,
  pageSlugFromTitle,
  pageSlugProblem,
  richTextPlain,
  type PageBlock,
  type PageContent,
  type PageThumbnail,
} from "@/lib/page-content";
import type { EditablePage, PageState } from "@/server/pages";

import { RichTextEditor } from "./rich-text-editor";

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

const newId = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `b${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;

const newBlock = (): PageBlock => ({ id: newId(), type: "richText", doc: EMPTY_DOC });

/**
 * One of Kaizen's pages (D42), held whole in the browser: title, address,
 * picture, search texts, who may read it, and its blocks, which can be
 * added, edited, deleted and dragged into order. Save keeps a draft;
 * Publish puts the page on the site.
 */
export function PageEditor({
  page,
  notice = null,
  origin,
  defaultDescription,
  upload,
}: {
  page: EditablePage | null;
  /** Said when the editor opens, such as "Draft saved." after a new page's first save. */
  notice?: string | null;
  origin: string;
  /** Kaizen's own description, the last fallback for a page without text. */
  defaultDescription: string;
  upload: Upload | null;
}) {
  const router = useRouter();
  const [saved, setSaved] = useState<EditablePage | null>(page);
  const [content, setContent] = useState<PageContent>(
    page?.draft ?? { title: "", slug: "", thumbnail: null, seo: { title: "", description: "" }, searchEngines: true, aiAssistants: true, blocks: [newBlock()] },
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
      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)_minmax(0,1fr)]">
        {/* The left sidebar, kept free for what comes next. */}
        <div className="hidden lg:block" />

        <div className="flex min-w-0 flex-col gap-6">
          <Blocks blocks={content.blocks} onChange={(blocks) => change({ blocks })} />
        </div>

        {/* On phones the title and settings come first. */}
        <div className="order-first flex min-w-0 flex-col gap-6 lg:order-none">
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
        </div>
      </div>

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
        <p className="text-sm text-muted">At the top of the page and when it is shared. Wide pictures work best.</p>
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

/** The page's content: rich-text blocks, one under another, to edit, delete and drag into order. */
function Blocks({ blocks, onChange }: { blocks: PageBlock[]; onChange: (blocks: PageBlock[]) => void }) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const [confirming, setConfirming] = useState<string | null>(null);
  const full = blocks.length >= BLOCKS_MAX;

  const insertAt = (index: number) => {
    const next = [...blocks];
    next.splice(index, 0, newBlock());
    onChange(next);
  };
  const move = (from: number, to: number) => onChange(arrayMove(blocks, from, to));
  const remove = (id: string) => {
    setConfirming(null);
    onChange(blocks.filter((block) => block.id !== id));
  };
  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    const from = blocks.findIndex((b) => b.id === active.id);
    const to = blocks.findIndex((b) => b.id === over.id);
    if (from >= 0 && to >= 0) move(from, to);
  };
  const name = (id: string | number) => `text block ${blocks.findIndex((b) => b.id === id) + 1}`;

  return (
    <section aria-labelledby="content-heading" className="flex flex-col gap-4">
      <div>
        <h2 id="content-heading" className="font-medium">
          Content
        </h2>
        <p className="text-sm text-muted">
          Text blocks, one under another. Drag a block by its handle, or use Up and Down, to change the order.
        </p>
      </div>
      <DndContext
        id="page-blocks"
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={onDragEnd}
        accessibility={{
          announcements: {
            onDragStart: ({ active }) => `Picked up ${name(active.id)}.`,
            onDragOver: ({ active, over }) => (over ? `${name(active.id)} is over ${name(over.id)}.` : undefined),
            onDragEnd: ({ active, over }) => (over ? `${name(active.id)} dropped at ${name(over.id)}.` : "Dropped."),
            onDragCancel: ({ active }) => `Moving ${name(active.id)} was cancelled.`,
          },
          screenReaderInstructions: {
            draggable: "To move this block, press Space or Enter, then the arrow keys, and Space or Enter again to drop it.",
          },
        }}
      >
        <SortableContext items={blocks.map((b) => b.id)} strategy={verticalListSortingStrategy}>
          <ol className="flex flex-col gap-4">
            {blocks.map((block, index) => (
              <SortableBlock
                key={block.id}
                block={block}
                position={index + 1}
                count={blocks.length}
                onChange={(doc) => onChange(blocks.map((b) => (b.id === block.id ? { ...b, doc } : b)))}
                onUp={() => move(index, index - 1)}
                onDown={() => move(index, index + 1)}
                onAddBelow={full ? null : () => insertAt(index + 1)}
                confirming={confirming === block.id}
                onDelete={() =>
                  richTextPlain(block.doc).trim() === "" ? remove(block.id) : setConfirming(block.id)
                }
                onConfirm={() => remove(block.id)}
                onCancel={() => setConfirming(null)}
              />
            ))}
          </ol>
        </SortableContext>
      </DndContext>
      {blocks.length === 0 && <p className="text-sm text-muted">The page has no content yet.</p>}
      <button type="button" onClick={() => insertAt(blocks.length)} disabled={full} className={`${small} w-fit`}>
        {full ? `At most ${BLOCKS_MAX} blocks` : "+ Add a text block"}
      </button>
      <p className={hint}>
        Want to see it as visitors will? Save, then choose Preview draft. More kinds of blocks (pictures, products,
        buttons) are coming.
      </p>
    </section>
  );
}

function SortableBlock({
  block,
  position,
  count,
  onChange,
  onUp,
  onDown,
  onAddBelow,
  confirming,
  onDelete,
  onConfirm,
  onCancel,
}: {
  block: PageBlock;
  position: number;
  count: number;
  onChange: (doc: PageBlock["doc"]) => void;
  onUp: () => void;
  onDown: () => void;
  onAddBelow: (() => void) | null;
  confirming: boolean;
  onDelete: () => void;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({
    id: block.id,
  });
  const name = `Text block ${position}`;
  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={`flex flex-col gap-2 rounded-lg border bg-background p-3 ${
        isDragging ? "relative z-30 border-foreground shadow-xl" : "border-border"
      }`}
    >
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          ref={setActivatorNodeRef}
          {...attributes}
          {...listeners}
          aria-label={`Drag ${name.toLowerCase()} to move it`}
          aria-roledescription="draggable block"
          className="flex min-h-9 min-w-9 cursor-grab touch-none items-center justify-center rounded-md border border-border active:cursor-grabbing"
        >
          <svg viewBox="0 0 24 24" aria-hidden className="size-5" fill="currentColor">
            <circle cx="9" cy="6" r="1.6" />
            <circle cx="15" cy="6" r="1.6" />
            <circle cx="9" cy="12" r="1.6" />
            <circle cx="15" cy="12" r="1.6" />
            <circle cx="9" cy="18" r="1.6" />
            <circle cx="15" cy="18" r="1.6" />
          </svg>
        </button>
        <span className="text-sm font-medium">{name}</span>
        <div className="ml-auto flex flex-wrap gap-1">
          <button type="button" onClick={onUp} disabled={position === 1} aria-label={`Move ${name.toLowerCase()} up`} className={small}>
            ↑ Up
          </button>
          <button
            type="button"
            onClick={onDown}
            disabled={position === count}
            aria-label={`Move ${name.toLowerCase()} down`}
            className={small}
          >
            ↓ Down
          </button>
          <button type="button" onClick={onDelete} aria-label={`Delete ${name.toLowerCase()}`} className={small}>
            Delete
          </button>
        </div>
      </div>
      {confirming && (
        <div role="alert" className="flex flex-wrap items-center gap-2 rounded-md bg-surface p-3 text-sm">
          Delete {name.toLowerCase()} and its text?
          <button type="button" onClick={onConfirm} className="min-h-9 rounded-md bg-red-700 px-3 text-white">
            Delete block
          </button>
          <button type="button" onClick={onCancel} className="underline">
            Keep it
          </button>
        </div>
      )}
      <RichTextEditor value={block.doc} onChange={onChange} label={name} />
      {onAddBelow && (
        <button type="button" onClick={onAddBelow} className="w-fit text-sm text-muted underline hover:text-foreground">
          + Add a text block below
        </button>
      )}
    </li>
  );
}
