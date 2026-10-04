"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState, useTransition } from "react";

import type { AltLanguage } from "@/lib/alt-text";
import { describeType, formatBytes } from "@/lib/image-size";
import { MEDIA_PAGE, MEDIA_SORTS, mediaAddress, type MediaQuery, type MediaSort } from "@/lib/media-query";
import type { AltResult, AltRun } from "@/server/alt-texts";
import type { MediaItem } from "@/server/media-library";

import { uploadPicture, type Upload } from "./image-upload";
import { Modal } from "./modal";
import { uploadVideoFile, type StartVideo } from "./video-upload";

/** What the library can ask of its owner's server (bound to the store, or Kaizen's). */
export type MediaActions = {
  describe: (id: string, texts: { alt: string; translations: Record<string, string> }) => Promise<{ ok: boolean }>;
  /** Writes one picture's alt texts with the site's AI (D89). */
  writeAlt: (id: string) => Promise<AltResult>;
  /** Writes a batch of the pictures' alt texts that need one; called until none remain. */
  writeAlts: (run: { since: string; rewrite: boolean }) => Promise<AltRun>;
  remove: (id: string) => Promise<{ ok: true } | { ok: false; problem: string }>;
  measure: (id: string, width: number, height: number) => Promise<void>;
};

type Query = MediaQuery;

const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/avif", "image/gif"];
const VIDEO_TYPES = ["video/mp4", "video/webm"];
/** Files uploaded at once, so a large batch neither floods the server nor waits in single file. */
const AT_ONCE = 3;

const input = "min-h-10 rounded-md border border-border bg-background px-3 text-sm";
const button = "min-h-10 rounded-md border border-border px-4 text-sm font-medium disabled:opacity-50";

/** Whether a file has an alt text in any language. */
const hasAlt = (item: MediaItem) => item.alt !== "" || Object.keys(item.altTranslations).length > 0;

const dimensions = (item: Pick<MediaItem, "width" | "height">) => (item.width && item.height ? `${item.width} × ${item.height} px` : null);
/** The file's address for saving it, named as it was uploaded (Storage sends it as an attachment). */
const downloadHref = (item: MediaItem) => `${item.url}${item.url.includes("?") ? "&" : "?"}download=${encodeURIComponent(item.fileName)}`;

/**
 * A site's media library (D88): every picture and video it uploaded, here
 * or in any editor. Files are added in bulk (dropped or chosen, pictures
 * shrunk in the browser as everywhere else); found by keyword and, with
 * the site's AI, by meaning; opened to see them large with their name,
 * type, size, measurements and everywhere they are used, to describe,
 * download or delete them (after a confirmation that says where they are
 * used). Pictures' alt texts (D89) are written by staff in each of the
 * site's languages, or by the site's AI, one picture or all of them.
 */
export function MediaLibrary({
  items,
  total,
  query,
  searched,
  meaning,
  basePath,
  upload,
  startVideo,
  actions,
  languages,
  altAi,
  altMissing,
}: {
  items: MediaItem[];
  total: number;
  query: Query;
  searched: boolean;
  /** Whether search by meaning is on (the site's AI has an embedding model). */
  meaning: boolean;
  /** The library's page, whose address holds the search. */
  basePath: string;
  upload: Upload | null;
  startVideo: StartVideo | null;
  actions: MediaActions;
  /** The site's languages, its main one first, for alt texts. */
  languages: AltLanguage[];
  /** Whether the site's AI has a text model to write alt texts with. */
  altAi: boolean;
  /** How many pictures have no alt text. */
  altMissing: number;
}) {
  const router = useRouter();
  const [openId, setOpenId] = useState<string | null>(null);
  const open = items.find((item) => item.id === openId) ?? null;

  // Files kept before the library have no measurements yet: the browser measures them once.
  useEffect(() => {
    const missing = items.filter((item) => item.width === null).slice(0, 24);
    let stopped = false;
    for (const item of missing) {
      if (item.kind === "image") {
        const picture = new Image();
        picture.onload = () => {
          if (!stopped && picture.naturalWidth > 0) void actions.measure(item.id, picture.naturalWidth, picture.naturalHeight);
        };
        picture.src = item.url;
      } else {
        const video = document.createElement("video");
        video.preload = "metadata";
        video.onloadedmetadata = () => {
          if (!stopped && video.videoWidth > 0) void actions.measure(item.id, video.videoWidth, video.videoHeight);
        };
        video.src = item.url;
      }
    }
    return () => {
      stopped = true;
    };
  }, [items, actions]);

  const address = (next: Partial<Query>) => mediaAddress(basePath, { ...query, ...next });

  return (
    <div className="flex flex-col gap-6">
      <Uploader upload={upload} startVideo={startVideo} onDone={() => router.refresh()} />

      <AltTexts missing={altMissing} ai={altAi} writeAlts={actions.writeAlts} onChanged={() => router.refresh()} />

      <form
        role="search"
        action={basePath}
        className="flex flex-wrap items-end gap-3 rounded-lg border border-border bg-background p-4"
        onSubmit={(event) => {
          event.preventDefault();
          const data = new FormData(event.currentTarget);
          router.push(
            address({
              q: String(data.get("q") ?? "").trim(),
              kind: (data.get("kind") as Query["kind"]) ?? "all",
              sort: (data.get("sort") as MediaSort) ?? "newest",
              limit: MEDIA_PAGE,
            }),
          );
        }}
      >
        <label className="flex min-w-0 flex-1 flex-col gap-1 text-sm font-medium">
          Search the library
          <input
            type="search"
            name="q"
            defaultValue={query.q}
            placeholder="A name, an alt text, or what is in it"
            className={`${input} font-normal`}
          />
        </label>
        <label className="flex flex-col gap-1 text-sm font-medium">
          Type
          <select name="kind" defaultValue={query.kind} onChange={(event) => event.currentTarget.form?.requestSubmit()} className={`${input} font-normal`}>
            <option value="all">Pictures and videos</option>
            <option value="image">Pictures</option>
            <option value="video">Videos</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm font-medium">
          Order
          <select
            name="sort"
            defaultValue={query.sort}
            disabled={Boolean(query.q)}
            onChange={(event) => event.currentTarget.form?.requestSubmit()}
            className={`${input} font-normal`}
          >
            {Object.entries(MEDIA_SORTS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" className={`${button} bg-foreground text-background`}>
          Search
        </button>
        {(query.q || query.kind !== "all") && (
          <Link href={basePath} className="min-h-10 content-center text-sm underline">
            Show everything
          </Link>
        )}
        <p className="basis-full text-xs text-muted">
          {meaning
            ? "Searches by the words in a file's name and alt text, and by meaning with your AI: what it shows, and what uses it. Best matches first."
            : "Searches by the words in a file's name and alt text. Set up an AI with an embedding model to search by meaning too."}
        </p>
      </form>

      <div className="flex flex-wrap items-center justify-between gap-3">
      <p role="status" className="text-sm text-muted">
        {searched
          ? total === 0
            ? `Nothing found for “${query.q}”.`
            : `${total === 1 ? "1 file" : `${total} files`} found for “${query.q}”.`
          : total === 0
            ? query.kind !== "all"
              ? `No ${query.kind === "image" ? "pictures" : "videos"} yet.`
              : "No files yet. Add pictures or videos above; everything you upload anywhere in the admin is kept here too."
            : total === 1
              ? "1 file."
              : `${total} files.`}
      </p>
        <nav aria-label="Show files as" className="flex overflow-hidden rounded-md border border-border text-sm">
          {(["grid", "list"] as const).map((view) => (
            <Link
              key={view}
              href={address({ view })}
              scroll={false}
              aria-current={query.view === view ? "true" : undefined}
              className={`min-h-9 content-center px-3 ${query.view === view ? "bg-foreground text-background" : "hover:bg-surface"}`}
            >
              {view === "grid" ? "Grid" : "List"}
            </Link>
          ))}
        </nav>
      </div>

      {items.length > 0 && query.view === "list" && <FileList items={items} onOpen={setOpenId} />}

      {items.length > 0 && query.view === "grid" && (
        <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6" aria-label="Files">
          {items.map((item) => (
            <li key={item.id}>
              <button
                type="button"
                onClick={() => setOpenId(item.id)}
                className="flex w-full flex-col overflow-hidden rounded-lg border border-border bg-background text-left hover:border-foreground/40 focus-visible:outline-2"
                aria-label={`${item.fileName}, ${describeType(item.contentType)}, ${formatBytes(item.sizeBytes)}${item.uses.length === 0 ? ", not in use" : `, used in ${item.uses.length} ${item.uses.length === 1 ? "place" : "places"}`}${item.kind === "image" && !hasAlt(item) ? ", no alt text" : ""}`}
              >
                <Preview item={item} small />
                <span className="flex flex-col gap-0.5 p-2 text-xs">
                  <span className="truncate text-sm font-medium">{item.fileName}</span>
                  <span className="text-muted">
                    {describeType(item.contentType)} · {formatBytes(item.sizeBytes)}
                  </span>
                  <span className="text-muted">{dimensions(item) ?? " "}</span>
                  <span className="mt-1 flex flex-wrap gap-1">
                    <span className={`w-fit rounded-full px-2 py-0.5 ${item.uses.length > 0 ? "bg-foreground text-background" : "bg-surface text-muted"}`}>
                      {item.uses.length > 0 ? `In use (${item.uses.length})` : "Not in use"}
                    </span>
                    {item.kind === "image" && !hasAlt(item) && (
                      <span className="w-fit rounded-full border border-amber-700 px-2 py-0.5 text-amber-800 dark:text-amber-300">No alt text</span>
                    )}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {items.length < total && (
        <Link href={address({ limit: query.limit + MEDIA_PAGE })} scroll={false} className={`${button} w-fit content-center`}>
          Show more ({total - items.length} more)
        </Link>
      )}

      {/* Keyed by the file, so each one opens from its own alt texts with nothing pending. */}
      {open && (
        <Details
          key={open.id}
          item={open}
          actions={actions}
          languages={languages}
          altAi={altAi}
          onClose={() => setOpenId(null)}
          onDeleted={() => {
            setOpenId(null);
            router.refresh();
          }}
        />
      )}
    </div>
  );
}

/** The files as a list, a row each with its details, alt text and uses; a row's name opens it. */
function FileList({ items, onOpen }: { items: MediaItem[]; onOpen: (id: string) => void }) {
  const cell = "px-3 py-2 align-middle";
  return (
    <div className="overflow-x-auto rounded-lg border border-border bg-background">
      <table className="w-full min-w-[40rem] text-left text-sm">
        <caption className="sr-only">Files</caption>
        <thead className="border-b border-border text-xs text-muted">
          <tr>
            <th scope="col" className={`${cell} w-16`}>
              <span className="sr-only">Preview</span>
            </th>
            <th scope="col" className={cell}>Name</th>
            <th scope="col" className={cell}>Type</th>
            <th scope="col" className={`${cell} text-right`}>Size</th>
            <th scope="col" className={`${cell} hidden md:table-cell`}>Width and height</th>
            <th scope="col" className={`${cell} hidden lg:table-cell`}>Alt text</th>
            <th scope="col" className={cell}>In use</th>
            <th scope="col" className={`${cell} hidden md:table-cell`}>Added</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={item.id} className="border-b border-border last:border-0 hover:bg-surface/60">
              <td className={cell}>
                <div className="size-12 overflow-hidden rounded-md">
                  <Preview item={item} small />
                </div>
              </td>
              <th scope="row" className={`${cell} max-w-64 font-medium`}>
                <button type="button" onClick={() => onOpen(item.id)} className="max-w-full truncate text-left underline-offset-2 hover:underline">
                  {item.fileName}
                </button>
              </th>
              <td className={`${cell} whitespace-nowrap text-muted`}>{describeType(item.contentType)}</td>
              <td className={`${cell} whitespace-nowrap text-right text-muted`}>{formatBytes(item.sizeBytes)}</td>
              <td className={`${cell} hidden whitespace-nowrap text-muted md:table-cell`}>{dimensions(item) ?? "–"}</td>
              <td className={`${cell} hidden max-w-80 lg:table-cell`}>
                {item.kind !== "image" ? (
                  <span className="text-muted">–</span>
                ) : hasAlt(item) ? (
                  <span className="line-clamp-2 text-muted">{item.alt || Object.values(item.altTranslations)[0]}</span>
                ) : (
                  <span className="rounded-full border border-amber-700 px-2 py-0.5 text-xs text-amber-800 dark:text-amber-300">No alt text</span>
                )}
              </td>
              <td className={`${cell} whitespace-nowrap text-muted`}>{item.uses.length > 0 ? `${item.uses.length} ${item.uses.length === 1 ? "place" : "places"}` : "Not in use"}</td>
              <td className={`${cell} hidden whitespace-nowrap text-muted md:table-cell`}>
                {new Date(item.createdAt).toLocaleDateString("en-GB", { dateStyle: "medium" })}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** A file as a picture: its small copy in the grid, the file itself when opened; a video as a video. */
function Preview({ item, small = false }: { item: MediaItem; small?: boolean }) {
  if (item.kind === "video") {
    return (
      // A video's first frame; opened, with its controls.
      <video
        src={item.url}
        controls={!small}
        muted
        playsInline
        preload="metadata"
        className={small ? "aspect-square w-full bg-surface object-cover" : "max-h-[60dvh] w-full rounded-md bg-black"}
      />
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element -- the site's own file, shown as it is
    <img
      src={small ? (item.thumbnailUrl ?? item.url) : item.url}
      alt={item.alt}
      loading={small ? "lazy" : undefined}
      className={small ? "aspect-square w-full bg-surface object-cover" : "mx-auto max-h-[60dvh] w-auto max-w-full rounded-md bg-surface object-contain"}
    />
  );
}

/** A file opened: seen large, with its details and where it is used; described, downloaded or deleted. */
function Details({
  item,
  actions,
  languages,
  altAi,
  onClose,
  onDeleted,
}: {
  item: MediaItem;
  actions: MediaActions;
  languages: AltLanguage[];
  altAi: boolean;
  onClose: () => void;
  onDeleted: () => void;
}) {
  const id = useId();
  const [confirming, setConfirming] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [copied, setCopied] = useState(false);

  const rows: [string, string][] = [
    ["File name", item.fileName],
    ["File type", describeType(item.contentType)],
    ["File size", formatBytes(item.sizeBytes)],
    ["Width and height", dimensions(item) ?? "Measured when shown"],
    ["Added", new Date(item.createdAt).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })],
  ];

  return (
    <>
      <Modal
        open={!confirming}
        onClose={onClose}
        title={item.fileName}
        wide
        footer={
          <>
            <button type="button" onClick={() => setConfirming(true)} className={`${button} mr-auto border-red-700 text-red-700`}>
              Delete
            </button>
            <button
              type="button"
              onClick={() => {
                void navigator.clipboard?.writeText(item.url).then(() => setCopied(true));
              }}
              className={button}
            >
              {copied ? "Address copied" : "Copy address"}
            </button>
            <a href={downloadHref(item)} download={item.fileName} className={`${button} content-center`}>
              Download
            </a>
            <button type="button" onClick={onClose} className={`${button} bg-foreground text-background`}>
              Done
            </button>
          </>
        }
      >
        <div className="flex flex-col gap-5">
          <Preview item={item} />
          <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-[max-content_1fr]">
            {rows.map(([term, value]) => (
              <div key={term} className="contents">
                <dt className="font-medium">{term}</dt>
                <dd className="break-all text-muted">{value}</dd>
              </div>
            ))}
          </dl>
          <section aria-labelledby={`${id}-uses`} className="flex flex-col gap-2">
            <h3 id={`${id}-uses`} className="text-sm font-medium">
              In use
            </h3>
            <Uses item={item} />
          </section>
          {item.kind === "image" && <AltTextForm item={item} languages={languages} altAi={altAi} actions={actions} />}
        </div>
      </Modal>

      <Modal
        open={confirming}
        onClose={() => setConfirming(false)}
        title={`Delete ${item.fileName}?`}
        footer={
          <>
            <button type="button" onClick={() => setConfirming(false)} className={button}>
              Keep it
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={() =>
                start(async () => {
                  const outcome = await actions.remove(item.id);
                  if (outcome.ok) {
                    setConfirming(false);
                    onDeleted();
                  } else setProblem(outcome.problem);
                })
              }
              className={`${button} border-red-700 bg-red-700 text-white`}
            >
              {pending ? "Deleting …" : "Delete for good"}
            </button>
          </>
        }
      >
        <div className="flex flex-col gap-3 text-sm">
          {item.uses.length === 0 ? (
            <p>The file is not used anywhere on the site. It is removed from the library and from storage.</p>
          ) : (
            <>
              <p>
                The file is used in {item.uses.length === 1 ? "this place" : `these ${item.uses.length} places`}. Deleting it
                leaves {item.uses.length === 1 ? "it" : "them"} without it: a picture there shows nothing until you choose
                another.
              </p>
              <Uses item={item} />
            </>
          )}
          <p className="text-muted">Deleting cannot be undone.</p>
          {problem && (
            <p role="alert" className="text-red-700">
              {problem}
            </p>
          )}
        </div>
      </Modal>
    </>
  );
}

/** Where a file is used, each with a link to change it there and, while visitors see it, its address on the site (D89). */
function Uses({ item }: { item: MediaItem }) {
  if (item.uses.length === 0) return <p className="text-sm text-muted">Not used anywhere on the site.</p>;
  return (
    <ul className="flex flex-col gap-2 text-sm">
      {item.uses.map((use, index) => (
        <li key={`${use.label}-${index}`} className="flex flex-col">
          {use.href ? (
            <Link href={use.href} className="underline">
              {use.label}
            </Link>
          ) : (
            use.label
          )}
          {use.siteUrl && (
            <a href={use.siteUrl} target="_blank" rel="noreferrer" className="break-all text-xs text-muted underline">
              {use.siteUrl}
              <span className="sr-only"> (on the site, opens in a new tab)</span>
            </a>
          )}
        </li>
      ))}
    </ul>
  );
}

/**
 * A picture's alt text in each of the site's languages (D89): what it
 * shows, for people who cannot see it and for search engines and AI
 * assistants. Written here, or by the site's AI; the site shows it wherever
 * the picture has no alt text of its own.
 */
function AltTextForm({
  item,
  languages,
  altAi,
  actions,
}: {
  item: MediaItem;
  languages: AltLanguage[];
  altAi: boolean;
  actions: MediaActions;
}) {
  const router = useRouter();
  const id = useId();
  const main = languages[0]?.locale ?? "";
  const textsOf = (alt: string, translations: Record<string, string>) =>
    Object.fromEntries(languages.map((language, index) => [language.locale, index === 0 ? alt : (translations[language.locale] ?? "")]));
  const [texts, setTexts] = useState<Record<string, string>>(() => textsOf(item.alt, item.altTranslations));
  const [source, setSource] = useState(item.altSource);
  const [status, setStatus] = useState<{ text: string; problem?: boolean } | null>(null);
  const [pending, start] = useTransition();
  const [writing, write] = useTransition();
  const initial = textsOf(item.alt, item.altTranslations);
  const changed = languages.some((language) => (texts[language.locale] ?? "") !== (initial[language.locale] ?? ""));

  return (
    <form
      className="flex flex-col gap-3"
      aria-labelledby={`${id}-heading`}
      onSubmit={(event) => {
        event.preventDefault();
        start(async () => {
          const { [main]: alt = "", ...translations } = texts;
          const outcome = await actions.describe(item.id, { alt, translations });
          setStatus(outcome.ok ? { text: "Alt text saved." } : { text: "The alt text could not be saved.", problem: true });
          if (outcome.ok) {
            setSource(Object.values(texts).some((text) => text.trim()) ? "staff" : null);
            router.refresh();
          }
        });
      }}
    >
      <div className="flex flex-wrap items-center gap-2">
        <h3 id={`${id}-heading`} className="text-sm font-medium">
          Alt text
        </h3>
        {source && (
          <span className="rounded-full bg-surface px-2 py-0.5 text-xs text-muted">{source === "ai" ? "Written by AI" : "Written by staff"}</span>
        )}
      </div>
      <p className="text-xs text-muted">
        What the picture shows, in a sentence, for people who cannot see it and for search engines and AI assistants. The site
        shows it wherever the picture has no alt text of its own; a language left empty shows the first one.
      </p>
      {languages.map((language, index) => (
        <label key={language.locale} className="flex flex-col gap-1 text-sm">
          <span className="font-medium">
            {language.name}
            {languages.length > 1 && index === 0 ? " (main language)" : ""}
            {language.extra ? " (for search and AI assistants)" : ""}
          </span>
          <textarea
            value={texts[language.locale] ?? ""}
            maxLength={300}
            rows={2}
            lang={language.locale}
            onChange={(event) => {
              setTexts((all) => ({ ...all, [language.locale]: event.target.value }));
              setStatus(null);
            }}
            className="rounded-md border border-border bg-background px-3 py-2 text-sm font-normal"
          />
        </label>
      ))}
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" disabled={pending || writing || !changed} className={button}>
          {pending ? "Saving …" : "Save alt text"}
        </button>
        {altAi && (
          <button
            type="button"
            disabled={pending || writing}
            onClick={() =>
              write(async () => {
                setStatus({ text: "The AI is looking at the picture …" });
                const outcome = await actions.writeAlt(item.id);
                if (!outcome.ok) {
                  setStatus({ text: outcome.problem, problem: true });
                  return;
                }
                setTexts(textsOf(outcome.alt, outcome.translations));
                setSource("ai");
                setStatus({ text: "The AI wrote and saved the alt text. Check it, change it if need be, and save." });
                router.refresh();
              })
            }
            className={button}
          >
            {writing ? "Writing …" : "Write with AI"}
          </button>
        )}
        <p role="status" aria-live="polite" className={`text-sm ${status?.problem ? "text-red-700" : ""}`}>
          {status?.text}
        </p>
      </div>
    </form>
  );
}

/**
 * Writes alt texts with the site's AI for every picture without one (D89),
 * or also writes the AI's earlier ones again, a batch at a time until none
 * remain, with the progress shown and a way to stop.
 */
function AltTexts({
  missing,
  ai,
  writeAlts,
  onChanged,
}: {
  missing: number;
  ai: boolean;
  writeAlts: MediaActions["writeAlts"];
  onChanged: () => void;
}) {
  const [rewrite, setRewrite] = useState(false);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<{ written: number; failed: number; remaining: number; problem: string | null } | null>(null);
  const stop = useRef(false);

  const run = async () => {
    stop.current = false;
    setRunning(true);
    const since = new Date().toISOString();
    let written = 0;
    let failed = 0;
    let problem: string | null = null;
    let remaining = Infinity;
    try {
      while (remaining > 0 && !stop.current) {
        const batch = await writeAlts({ since, rewrite });
        written += batch.written;
        failed += batch.failed;
        remaining = batch.remaining;
        problem = batch.problem ?? problem;
        setProgress({ written, failed, remaining, problem });
        // Nothing done in a batch: the AI cannot, or nothing is left that it can.
        if (batch.written + batch.failed === 0) break;
        if (batch.written === 0 && batch.problem) break;
      }
    } catch {
      setProgress({ written, failed, remaining: 0, problem: "The run stopped. Try again." });
    }
    setRunning(false);
    onChanged();
  };

  return (
    <section aria-label="Alt texts" className="flex flex-col gap-2 rounded-lg border border-border bg-background p-4">
      <p className="text-sm">
        <span className="font-medium">Alt texts.</span>{" "}
        {missing === 0
          ? "Every picture has an alt text."
          : `${missing === 1 ? "1 picture has" : `${missing} pictures have`} no alt text.`}{" "}
        {ai
          ? "Your AI can look at each picture and write one in every language of the site; new pictures get theirs within a few minutes of being added."
          : "Set up an AI with a model that sees pictures under AI settings, and it can write them for you."}
      </p>
      {ai && (
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            disabled={running || (missing === 0 && !rewrite)}
            onClick={() => void run()}
            className={`${button} bg-foreground text-background`}
          >
            {running ? "Writing alt texts …" : rewrite ? "Write alt texts with AI" : "Write missing alt texts with AI"}
          </button>
          {running ? (
            <button type="button" onClick={() => (stop.current = true)} className={button}>
              Stop
            </button>
          ) : (
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={rewrite} onChange={(event) => setRewrite(event.target.checked)} />
              Also write the AI&apos;s earlier ones again (staff&apos;s are kept)
            </label>
          )}
        </div>
      )}
      {progress && (
        <p role="status" aria-live="polite" className="text-sm">
          {running
            ? `Writing: ${progress.written} done${progress.remaining > 0 ? `, ${progress.remaining} to go` : ""}.`
            : `${progress.written === 1 ? "1 alt text" : `${progress.written} alt texts`} written${progress.failed > 0 ? `, ${progress.failed} could not be` : ""}.`}
          {progress.problem && <span className="block text-red-700">{progress.problem}</span>}
        </p>
      )}
    </section>
  );
}

type Job = { key: string; name: string; state: "waiting" | "uploading" | "done" | "failed"; problem?: string };

/**
 * Adds files in bulk: dropped on it or chosen, several at once. Pictures are
 * shrunk in the browser as everywhere else; videos go straight to Storage.
 */
function Uploader({ upload, startVideo, onDone }: { upload: Upload | null; startVideo: StartVideo | null; onDone: () => void }) {
  const inputId = useId();
  const [jobs, setJobs] = useState<Job[]>([]);
  const [over, setOver] = useState(false);
  const busy = jobs.some((job) => job.state === "waiting" || job.state === "uploading");

  if (!upload) return <p className="rounded-lg border border-border p-4 text-sm text-muted">Uploads are not set up on this server.</p>;

  const set = (key: string, patch: Partial<Job>) => setJobs((all) => all.map((job) => (job.key === key ? { ...job, ...patch } : job)));

  const add = async (files: File[]) => {
    if (files.length === 0) return;
    const batch = files.map((file, index) => ({ file, key: `${Date.now()}-${index}-${file.name}` }));
    setJobs((all) => [...all.filter((job) => job.state !== "done"), ...batch.map(({ file, key }) => ({ key, name: file.name, state: "waiting" as const }))]);
    const queue = [...batch];
    const worker = async () => {
      for (let next = queue.shift(); next; next = queue.shift()) {
        const { file, key } = next;
        set(key, { state: "uploading" });
        let outcome: { ok: true } | { ok: false; problem: string };
        if (IMAGE_TYPES.includes(file.type)) {
          try {
            const result = await uploadPicture(upload, file);
            outcome = result.ok ? { ok: true } : result;
          } catch {
            outcome = { ok: false, problem: `${file.name} could not be read as a picture.` };
          }
        } else if (VIDEO_TYPES.includes(file.type) && startVideo) {
          const result = await uploadVideoFile(startVideo, null, file);
          outcome = result.ok ? { ok: true } : result;
        } else {
          outcome = { ok: false, problem: "Use a JPEG, PNG, WebP, AVIF or GIF picture, or an MP4 or WebM video." };
        }
        set(key, outcome.ok ? { state: "done" } : { state: "failed", problem: outcome.problem });
      }
    };
    await Promise.all(Array.from({ length: Math.min(AT_ONCE, batch.length) }, worker));
    onDone();
  };

  const done = jobs.filter((job) => job.state === "done").length;
  return (
    <section
      aria-label="Add files"
      onDragOver={(event) => {
        event.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(event) => {
        event.preventDefault();
        setOver(false);
        void add([...event.dataTransfer.files]);
      }}
      className={`flex flex-col gap-3 rounded-lg border-2 border-dashed p-6 text-center ${over ? "border-foreground bg-surface" : "border-border bg-background"}`}
    >
      <p className="font-medium">Drop pictures and videos here</p>
      <p className="text-sm text-muted">
        JPEG, PNG, WebP, AVIF or GIF pictures (made at most 1600 pixels wide, with a small copy), and MP4 or WebM videos up to
        50 MB. As many as you like at once.
      </p>
      <label htmlFor={inputId} className={`${button} mx-auto w-fit cursor-pointer content-center bg-foreground text-background`}>
        {busy ? "Uploading …" : "Choose files"}
      </label>
      <input
        id={inputId}
        type="file"
        multiple
        accept={[...IMAGE_TYPES, ...(startVideo ? VIDEO_TYPES : [])].join(",")}
        className="sr-only"
        onChange={(event) => {
          void add([...(event.target.files ?? [])]);
          event.target.value = "";
        }}
      />
      {jobs.length > 0 && (
        <div className="flex flex-col gap-1 text-left text-sm">
          <p role="status" aria-live="polite">
            {busy ? `Uploading: ${done} of ${jobs.length} done.` : `${done === 1 ? "1 file" : `${done} files`} added.`}
          </p>
          <ul className="flex max-h-48 flex-col gap-1 overflow-y-auto">
            {jobs.map((job) => (
              <li key={job.key} className="flex items-center justify-between gap-3">
                <span className="truncate">{job.name}</span>
                <span className={job.state === "failed" ? "text-red-700" : "text-muted"}>
                  {job.state === "waiting" ? "Waiting" : job.state === "uploading" ? "Uploading …" : job.state === "done" ? "Added" : job.problem}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
