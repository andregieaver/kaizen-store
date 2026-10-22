"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState, useTransition } from "react";

import type { AltLanguage } from "@/lib/alt-text";
import { ADMIN_LANG_FACTS } from "@/lib/admin-lang";
import { countWords, fillWords } from "@/lib/admin-fill";
import type { WebsiteMessages } from "@/lib/admin-messages/website.en";
import { formatBytes } from "@/lib/image-size";
import { MEDIA_PAGE, mediaAddress, type MediaQuery, type MediaSort } from "@/lib/media-query";
import type { AltResult, AltRun } from "@/server/alt-texts";
import type { MediaItem } from "@/server/media-library";
import type { CompressOutcome } from "@/server/media-compress";

import { compressPlan } from "@/lib/media-compress";

import { useAdminLang, useAdminText } from "./admin-text";
import { uploadPicture, type Saving, type Upload } from "./image-upload";
import { compressLibraryFile, type CompressActions } from "./media-compress";
import { Modal } from "./modal";
import { uploadVideoFile, type StartVideo } from "./video-upload";
import { CARD_CLASS } from "@/components/admin/ui";

/** What the library can ask of its owner's server (bound to the store, or Kaizen's). */
export type MediaActions = {
  describe: (id: string, texts: { alt: string; translations: Record<string, string> }) => Promise<{ ok: boolean }>;
  /** Writes one picture's alt texts with the site's AI (D89). */
  writeAlt: (id: string) => Promise<AltResult>;
  /** Writes a batch of the pictures' alt texts that need one; called until none remain. */
  writeAlts: (run: { since: string; rewrite: boolean }) => Promise<AltRun>;
  remove: (id: string) => Promise<{ ok: true } | { ok: false; problem: string }>;
  /** Deletes up to `BULK_AT_ONCE` files in one request (the library's bulk delete); how many went and how many were kept. */
  removeMany: (ids: string[]) => Promise<{ deleted: number; kept: number; problem?: string }>;
  measure: (id: string, width: number, height: number) => Promise<void>;
};

type Query = MediaQuery;

const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/avif", "image/gif"];
const VIDEO_TYPES = ["video/mp4", "video/webm"];
/** Files uploaded at once, so a large batch neither floods the server nor waits in single file. */
const AT_ONCE = 3;
/** Files deleted in one request: the server's limit (`MEDIA_DELETE_MAX`), so a larger choice is asked for in turns. */
const BULK_AT_ONCE = 100;

const input = "min-h-10 rounded-md border border-line bg-card px-3 text-sm";
const button = "min-h-10 rounded-pill border border-edge px-4 text-sm font-medium disabled:opacity-50";

/** Whether a file has an alt text in any language. */
type Words = WebsiteMessages["media"];

/** A file's type in words: a picture or a video of its format. */
function describeType(contentType: string, w: Words): string {
  const [kind, sub = ""] = contentType.split("/");
  const name = { jpeg: "JPEG", png: "PNG", webp: "WebP", avif: "AVIF", gif: "GIF", "svg+xml": "SVG", mp4: "MP4", webm: "WebM" }[sub] ?? sub.toUpperCase();
  if (kind === "image") return fillWords(w.picture, { type: name });
  if (kind === "video") return fillWords(w.video, { type: name });
  return contentType;
}

/** What compressing saved, as `savingWords()` says it (`src/lib/image-quality.ts`), in the admin's words. */
function savingWords(before: number, after: number, w: Words): string | null {
  if (before <= 0 || after >= before) return null;
  const saved = before - after;
  const percent = Math.round((saved / before) * 100);
  if (percent < 1) return null;
  return fillWords(w.saved, { bytes: formatBytes(saved), percent });
}

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
  compress,
  waiting,
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
  /** Compressing files uploaded before compressing was measured (D213); null where uploads are not set up. */
  compress: CompressActions | null;
  /** How many files wait for Compress. */
  waiting: number;
}) {
  const w = useAdminText("website").media;
  const router = useRouter();
  const [openId, setOpenId] = useState<string | null>(null);
  const open = items.find((item) => item.id === openId) ?? null;
  // Choosing several files to delete together (a page copy adds many pictures, which fill the library): a file is chosen instead of opened.
  const [choosing, setChoosing] = useState(false);
  const [chosen, setChosen] = useState<ReadonlySet<string>>(new Set());
  const [bulkOpen, setBulkOpen] = useState(false);
  const pick = (id: string) =>
    setChosen((now) => {
      const next = new Set(now);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  const choose = (ids: string[]) => setChosen(new Set(ids));
  const stopChoosing = () => {
    setChoosing(false);
    setChosen(new Set());
  };
  const selected = items.filter((item) => chosen.has(item.id));

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

      {compress && <CompressAll waiting={waiting} compress={compress} onChanged={() => router.refresh()} />}

      <form
        role="search"
        action={basePath}
        className={`flex flex-wrap items-end gap-3 p-4 ${CARD_CLASS}`}
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
          {w.searchLabel}
          <input
            type="search"
            name="q"
            defaultValue={query.q}
            placeholder={w.searchPlaceholder}
            className={`${input} font-normal`}
          />
        </label>
        <label className="flex flex-col gap-1 text-sm font-medium">
          {w.type}
          <select name="kind" defaultValue={query.kind} onChange={(event) => event.currentTarget.form?.requestSubmit()} className={`${input} font-normal`}>
            <option value="all">{w.kinds.all}</option>
            <option value="image">{w.kinds.image}</option>
            <option value="video">{w.kinds.video}</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm font-medium">
          {w.order}
          <select
            name="sort"
            defaultValue={query.sort}
            disabled={Boolean(query.q)}
            onChange={(event) => event.currentTarget.form?.requestSubmit()}
            className={`${input} font-normal`}
          >
            {Object.entries(w.sorts).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" className={`${button} bg-brand text-brand-ink`}>
          {w.search}
        </button>
        {(query.q || query.kind !== "all") && (
          <Link href={basePath} className="min-h-10 content-center text-sm underline">
            {w.showEverything}
          </Link>
        )}
        <p className="basis-full text-xs text-muted">
          {meaning ? w.searchMeaning : w.searchWords}
        </p>
      </form>

      <div className="flex flex-wrap items-center justify-between gap-3">
      <p role="status" className="text-sm text-muted">
        {searched
          ? total === 0
            ? fillWords(w.nothingFound, { q: query.q })
            : countWords(total, w.found, { q: query.q })
          : total === 0
            ? query.kind !== "all"
              ? query.kind === "image"
                ? w.noPictures
                : w.noVideos
              : w.noFiles
            : countWords(total, w.files)}
      </p>
        <div className="flex flex-wrap items-center gap-2">
          {items.length > 0 && (
            <button type="button" onClick={() => (choosing ? stopChoosing() : setChoosing(true))} aria-pressed={choosing} className={`${button} min-h-9`}>
              {choosing ? w.cancelChoosing : w.chooseFiles}
            </button>
          )}
        <nav aria-label={w.showAs} className="flex overflow-hidden rounded-md border border-line text-sm">
          {(["grid", "list"] as const).map((view) => (
            <Link
              key={view}
              href={address({ view })}
              scroll={false}
              aria-current={query.view === view ? "true" : undefined}
              className={`min-h-9 content-center px-3 ${query.view === view ? "bg-brand text-brand-ink" : "hover:bg-sunken"}`}
            >
              {view === "grid" ? w.grid : w.list}
            </Link>
          ))}
        </nav>
        </div>
      </div>

      {choosing && (
        <div role="region" aria-label={w.deleteSeveral} className="sticky top-2 z-10 flex flex-wrap items-center gap-2 rounded-panel bg-sunken p-3 text-sm shadow-sm">
          <p role="status" className="mr-auto font-medium">
            {chosen.size === 0 ? w.chooseToDelete : countWords(chosen.size, w.chosen)}
          </p>
          <button type="button" onClick={() => choose(items.map((item) => item.id))} className={`${button} min-h-9`}>
            {fillWords(w.chooseAll, { n: items.length })}
          </button>
          <button type="button" onClick={() => choose(items.filter((item) => item.uses.length === 0).map((item) => item.id))} className={`${button} min-h-9`}>
            {w.chooseUnused}
          </button>
          <button type="button" disabled={chosen.size === 0} onClick={() => setChosen(new Set())} className={`${button} min-h-9`}>
            {w.clear}
          </button>
          <button type="button" disabled={chosen.size === 0} onClick={() => setBulkOpen(true)} className={`${button} min-h-9 border-danger-text bg-danger-soft text-danger-text`}>
            {chosen.size > 0 ? fillWords(w.deleteChosen, { n: chosen.size }) : w.deleteNone}
          </button>
        </div>
      )}

      {items.length > 0 && query.view === "list" && <FileList items={items} onOpen={setOpenId} chosen={choosing ? chosen : null} onPick={pick} />}

      {items.length > 0 && query.view === "grid" && (
        <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6" aria-label={w.filesLabel}>
          {items.map((item) => (
            <li key={item.id}>
              <button
                type="button"
                onClick={() => (choosing ? pick(item.id) : setOpenId(item.id))}
                aria-pressed={choosing ? chosen.has(item.id) : undefined}
                className={`relative flex w-full flex-col overflow-hidden rounded-panel border bg-card text-left hover:border-brand/40 focus-visible:outline-2 ${choosing && chosen.has(item.id) ? "border-brand ring-2 ring-ink" : "border-line"}`}
                aria-label={`${fillWords(w.tileLabel, { name: item.fileName, type: describeType(item.contentType, w), size: formatBytes(item.sizeBytes) })}${item.uses.length === 0 ? w.tileUnused : countWords(item.uses.length, w.tileUsed)}${item.kind === "image" && !hasAlt(item) ? w.tileNoAlt : ""}`}
              >
                <Preview item={item} small />
                {choosing && (
                  <span aria-hidden="true" className={`absolute left-2 top-2 flex size-6 items-center justify-center rounded-md border-2 text-sm font-medium ${chosen.has(item.id) ? "border-brand bg-brand text-brand-ink" : "border-brand/60 bg-card"}`}>
                    {chosen.has(item.id) ? "✓" : ""}
                  </span>
                )}
                <span className="flex flex-col gap-0.5 p-2 text-xs">
                  <span className="truncate text-sm font-medium">{item.fileName}</span>
                  <span className="text-muted">
                    {describeType(item.contentType, w)} · {formatBytes(item.sizeBytes)}
                  </span>
                  <span className="text-muted">{dimensions(item) ?? " "}</span>
                  <span className="mt-1 flex flex-wrap gap-1">
                    <span className={`w-fit rounded-full px-2 py-0.5 ${item.uses.length > 0 ? "bg-brand text-brand-ink" : "bg-sunken text-muted"}`}>
                      {item.uses.length > 0 ? fillWords(w.inUseCount, { n: item.uses.length }) : w.notInUse}
                    </span>
                    {item.kind === "image" && !hasAlt(item) && (
                      <span className="w-fit rounded-full border border-warning-text px-2 py-0.5 text-warning-text">{w.noAlt}</span>
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
          {fillWords(w.showMore, { n: total - items.length })}
        </Link>
      )}

      {bulkOpen && (
        <BulkDelete
          files={selected}
          chosenCount={chosen.size}
          actions={actions}
          onClose={() => setBulkOpen(false)}
          onDone={() => {
            setBulkOpen(false);
            stopChoosing();
            router.refresh();
          }}
        />
      )}

      {/* Keyed by the file, so each one opens from its own alt texts with nothing pending. */}
      {open && (
        <Details
          key={open.id}
          item={open}
          actions={actions}
          compress={compress}
          languages={languages}
          altAi={altAi}
          onCompressed={() => router.refresh()}
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
function FileList({ items, onOpen, chosen, onPick }: { items: MediaItem[]; onOpen: (id: string) => void; chosen: ReadonlySet<string> | null; onPick: (id: string) => void }) {
  const w = useAdminText("website").media;
  const locale = ADMIN_LANG_FACTS[useAdminLang()].locale;
  const cell = "px-3 py-2 align-middle";
  return (
    <div className={`overflow-x-auto ${CARD_CLASS}`}>
      <table className="w-full min-w-[40rem] text-left text-sm">
        <caption className="sr-only">{w.filesLabel}</caption>
        <thead className="border-b border-line text-xs text-muted">
          <tr>
            {chosen && (
              <th scope="col" className={`${cell} w-10`}>
                <span className="sr-only">{w.columns.choose}</span>
              </th>
            )}
            <th scope="col" className={`${cell} w-16`}>
              <span className="sr-only">{w.columns.preview}</span>
            </th>
            <th scope="col" className={cell}>{w.columns.name}</th>
            <th scope="col" className={cell}>{w.columns.type}</th>
            <th scope="col" className={`${cell} text-right`}>{w.columns.size}</th>
            <th scope="col" className={`${cell} hidden md:table-cell`}>{w.columns.dimensions}</th>
            <th scope="col" className={`${cell} hidden lg:table-cell`}>{w.columns.alt}</th>
            <th scope="col" className={cell}>{w.columns.inUse}</th>
            <th scope="col" className={`${cell} hidden md:table-cell`}>{w.columns.added}</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={item.id} className="border-b border-edge last:border-0 hover:bg-sunken/60">
              {chosen && (
                <td className={cell}>
                  <input type="checkbox" checked={chosen.has(item.id)} onChange={() => onPick(item.id)} aria-label={fillWords(w.chooseFile, { name: item.fileName })} className="size-5" />
                </td>
              )}
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
              <td className={`${cell} whitespace-nowrap text-muted`}>{describeType(item.contentType, w)}</td>
              <td className={`${cell} whitespace-nowrap text-right text-muted`}>{formatBytes(item.sizeBytes)}</td>
              <td className={`${cell} hidden whitespace-nowrap text-muted md:table-cell`}>{dimensions(item) ?? "–"}</td>
              <td className={`${cell} hidden max-w-80 lg:table-cell`}>
                {item.kind !== "image" ? (
                  <span className="text-muted">–</span>
                ) : hasAlt(item) ? (
                  <span className="line-clamp-2 text-muted">{item.alt || Object.values(item.altTranslations)[0]}</span>
                ) : (
                  <span className="rounded-full border border-warning-text px-2 py-0.5 text-xs text-warning-text">{w.noAlt}</span>
                )}
              </td>
              <td className={`${cell} whitespace-nowrap text-muted`}>{item.uses.length > 0 ? countWords(item.uses.length, w.places) : w.notInUse}</td>
              <td className={`${cell} hidden whitespace-nowrap text-muted md:table-cell`}>
                {new Date(item.createdAt).toLocaleDateString(locale, { dateStyle: "medium" })}
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
        className={small ? "aspect-square w-full bg-sunken object-cover" : "max-h-[60dvh] w-full rounded-md bg-black"}
      />
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element -- the site's own file, shown as it is
    <img
      src={small ? (item.thumbnailUrl ?? item.url) : item.url}
      alt={item.alt}
      loading={small ? "lazy" : undefined}
      className={small ? "aspect-square w-full bg-sunken object-cover" : "mx-auto max-h-[60dvh] w-auto max-w-full rounded-md bg-sunken object-contain"}
    />
  );
}

/** A file opened: seen large, with its details and where it is used; described, downloaded or deleted. */
function Details({
  item,
  actions,
  compress,
  languages,
  altAi,
  onCompressed,
  onClose,
  onDeleted,
}: {
  item: MediaItem;
  actions: MediaActions;
  compress: CompressActions | null;
  languages: AltLanguage[];
  altAi: boolean;
  onCompressed: () => void;
  onClose: () => void;
  onDeleted: () => void;
}) {
  const w = useAdminText("website").media;
  const locale = ADMIN_LANG_FACTS[useAdminLang()].locale;
  const id = useId();
  const [confirming, setConfirming] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [copied, setCopied] = useState(false);

  const rows: [string, string][] = [
    [w.rows.fileName, item.fileName],
    [w.rows.fileType, describeType(item.contentType, w)],
    [w.rows.fileSize, formatBytes(item.sizeBytes)],
    [w.rows.dimensions, dimensions(item) ?? w.measuredWhenShown],
    [w.rows.added, new Date(item.createdAt).toLocaleString(locale, { dateStyle: "medium", timeStyle: "short" })],
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
            <button type="button" onClick={() => setConfirming(true)} className={`${button} mr-auto border-danger-text text-danger-text`}>
              {w.delete}
            </button>
            <button
              type="button"
              onClick={() => {
                void navigator.clipboard?.writeText(item.url).then(() => setCopied(true));
              }}
              className={button}
            >
              {copied ? w.addressCopied : w.copyAddress}
            </button>
            <a href={downloadHref(item)} download={item.fileName} className={`${button} content-center`}>
              {w.download}
            </a>
            <button type="button" onClick={onClose} className={`${button} bg-brand text-brand-ink`}>
              {w.done}
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
            <h3 id={`${id}-uses`} className="text-body-strong text-ink">
              {w.inUse}
            </h3>
            <Uses item={item} />
          </section>
          {compress && <CompressOne item={item} compress={compress} onCompressed={onCompressed} />}
          {item.kind === "image" && <AltTextForm item={item} languages={languages} altAi={altAi} actions={actions} />}
        </div>
      </Modal>

      <Modal
        open={confirming}
        onClose={() => setConfirming(false)}
        title={fillWords(w.deleteFile, { name: item.fileName })}
        footer={
          <>
            <button type="button" onClick={() => setConfirming(false)} className={button}>
              {w.keepIt}
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
              className={`${button} border-danger-text bg-danger-soft text-danger-text`}
            >
              {pending ? w.deleting : w.deleteForGood}
            </button>
          </>
        }
      >
        <div className="flex flex-col gap-3 text-sm">
          {item.uses.length === 0 ? (
            <p>{w.unusedRemoved}</p>
          ) : (
            <>
              <p>{item.uses.length === 1 ? w.usedOne : fillWords(w.usedMany, { n: item.uses.length })}</p>
              <Uses item={item} />
            </>
          )}
          <p className="text-muted">{w.cannotUndo}</p>
          {problem && (
            <p role="alert" className="text-danger-text">
              {problem}
            </p>
          )}
        </div>
      </Modal>
    </>
  );
}

/** What a Compress run says it did (D213): a saving, and whether the original stayed in storage, or why nothing changed. */
function outcomeWords(outcome: CompressOutcome, w: Words): string {
  if (!outcome.ok) return outcome.problem;
  const saved = savingWords(outcome.before, outcome.after, w) ?? w.compressed;
  return fillWords(outcome.keptOriginal ? w.keptOriginal : w.everywhereSmaller, { saved });
}

/**
 * Compressing one file (D213): offered for a file from before compressing was measured, with what it will do, and done in
 * this browser; anything that keeps it as it is says why.
 */
function CompressOne({ item, compress, onCompressed }: { item: MediaItem; compress: CompressActions; onCompressed: () => void }) {
  const w = useAdminText("website").media;
  const id = useId();
  const plan = compressPlan(item);
  const [state, setState] = useState<{ busy: string | null; said: string | null; failed: boolean }>({ busy: null, said: null, failed: false });
  const run = async () => {
    setState({ busy: w.compressing, said: null, failed: false });
    const outcome = await compressLibraryFile(item, compress, (progress) =>
      setState((now) => ({ ...now, busy: progress < 1 ? fillWords(w.compressingPercent, { percent: Math.round(progress * 100) }) : w.uploading })),
    );
    setState({ busy: null, said: outcomeWords(outcome, w), failed: !outcome.ok });
    if (outcome.ok) onCompressed();
  };
  return (
    <section aria-labelledby={`${id}-size`} className="flex flex-col gap-2">
      <h3 id={`${id}-size`} className="text-body-strong text-ink">
        {w.size}
      </h3>
      {plan.offered ? (
        <>
          <p className="text-sm text-muted">{item.kind === "video" ? w.compressOneVideo : w.compressOne}</p>
          <button type="button" disabled={state.busy !== null} onClick={() => void run()} className={`${button} w-fit`}>
            {state.busy ?? w.compress}
          </button>
        </>
      ) : (
        !state.said && <p className="text-sm text-muted">{plan.why}</p>
      )}
      {state.said && (
        <p role={state.failed ? "alert" : "status"} className={`text-sm ${state.failed ? "text-danger-text " : "text-muted"}`}>
          {state.said}
        </p>
      )}
    </section>
  );
}

/**
 * Compressing every file from before compressing was measured (D213), the largest first, one at a time in this browser
 * (each takes a few seconds; a video longer), with what was saved so far and a Stop.
 */
function CompressAll({ waiting, compress, onChanged }: { waiting: number; compress: CompressActions; onChanged: () => void }) {
  const w = useAdminText("website").media;
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<{ done: number; of: number; saved: number; kept: number; now: string | null } | null>(null);
  const stop = useRef(false);

  const run = async () => {
    stop.current = false;
    setRunning(true);
    let done = 0;
    let saved = 0;
    let kept = 0;
    try {
      const files = (await compress.waiting()).filter((file) => compressPlan(file).offered);
      setProgress({ done, of: files.length, saved, kept, now: null });
      for (const file of files) {
        if (stop.current) break;
        setProgress({ done, of: files.length, saved, kept, now: file.fileName });
        const outcome = await compressLibraryFile(file, compress);
        done += 1;
        if (outcome.ok) saved += outcome.before - outcome.after;
        else kept += 1;
        setProgress({ done, of: files.length, saved, kept, now: null });
      }
    } catch {
      setProgress((now) => (now ? { ...now, now: null } : null));
    }
    setRunning(false);
    onChanged();
  };

  if (waiting === 0 && !progress) return null;
  return (
    <section aria-label={w.compressFilesLabel} className={`flex flex-col gap-2 p-4 ${CARD_CLASS}`}>
      <p className="text-sm">
        <span className="font-medium">{w.compressFiles}</span>{" "}
        {waiting === 0 ? w.allSmall : countWords(waiting, w.waiting)}
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" disabled={running || waiting === 0} onClick={() => void run()} className={`${button} bg-brand text-brand-ink`}>
          {running ? w.compressing : countWords(waiting, w.compressCount)}
        </button>
        {running && (
          <button type="button" onClick={() => (stop.current = true)} className={button}>
            {w.stop}
          </button>
        )}
      </div>
      {progress && (
        <p role="status" aria-live="polite" className="text-sm text-muted">
          {fillWords(w.progressDone, { done: progress.done, of: progress.of })}
          {progress.saved > 0 ? fillWords(w.progressSaved, { bytes: formatBytes(progress.saved) }) : ""}
          {progress.kept > 0 ? fillWords(w.progressKept, { n: progress.kept }) : ""}
          {progress.now ? fillWords(w.progressNow, { name: progress.now }) : "."}
        </p>
      )}
    </section>
  );
}

/**
 * Deleting the chosen files together: says how many, how large, and how many are used on the site (they show nothing where they were), then deletes them in turns of
 * `BULK_AT_ONCE`, with the progress, and stops at the first request that fails.
 */
function BulkDelete({ files, chosenCount, actions, onClose, onDone }: { files: MediaItem[]; chosenCount: number; actions: MediaActions; onClose: () => void; onDone: () => void }) {
  const w = useAdminText("website").media;
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState(0);
  const [problem, setProblem] = useState<string | null>(null);
  const used = files.filter((file) => file.uses.length > 0);
  const bytes = files.reduce((sum, file) => sum + file.sizeBytes, 0);
  const run = async () => {
    setRunning(true);
    setProblem(null);
    let gone = 0;
    for (let at = 0; at < files.length; at += BULK_AT_ONCE) {
      const turn = files.slice(at, at + BULK_AT_ONCE).map((file) => file.id);
      let outcome: Awaited<ReturnType<MediaActions["removeMany"]>>;
      try {
        outcome = await actions.removeMany(turn);
      } catch {
        outcome = { deleted: 0, kept: turn.length, problem: w.bulkFailed };
      }
      gone += outcome.deleted;
      setDone(gone);
      if (outcome.kept > 0) {
        setProblem(countWords(gone, w.bulkPartly, { problem: outcome.problem ?? w.someCouldNot }));
        setRunning(false);
        if (gone > 0) onDone();
        return;
      }
    }
    onDone();
  };
  return (
    <Modal
      open
      onClose={running ? () => {} : onClose}
      title={countWords(chosenCount, w.bulkTitle)}
      footer={
        <>
          <button type="button" disabled={running} onClick={onClose} className={button}>
            {w.keepThem}
          </button>
          <button type="button" disabled={running} onClick={() => void run()} className={`${button} border-danger-text bg-danger-soft text-danger-text`}>
            {running ? fillWords(w.deletingOf, { done, of: files.length }) : w.deleteForGood}
          </button>
        </>
      }
    >
      <div className="flex flex-col gap-3 text-sm">
        <p>
          {countWords(chosenCount, w.bulkRemoved, { size: formatBytes(bytes) })}
          {chosenCount > files.length && w.onlyShown}
        </p>
        {used.length > 0 ? (
          <div className="flex flex-col gap-2">
            <p className="font-medium text-danger-text">
              {countWords(used.length, w.bulkUsed)}
            </p>
            <ul className="max-h-40 list-disc overflow-y-auto pl-5 text-muted">
              {used.slice(0, 12).map((file) => (
                <li key={file.id}>
                  {file.fileName}: {file.uses[0]?.label}
                  {file.uses.length > 1 ? fillWords(w.andMore, { n: file.uses.length - 1 }) : ""}
                </li>
              ))}
              {used.length > 12 && <li>{fillWords(w.andMoreItem, { n: used.length - 12 })}</li>}
            </ul>
          </div>
        ) : (
          <p>{w.noneUsed}</p>
        )}
        <p className="text-muted">{w.cannotUndo}</p>
        {problem && (
          <p role="alert" className="text-danger-text">
            {problem}
          </p>
        )}
      </div>
    </Modal>
  );
}

/** Where a file is used, each with a link to change it there and, while visitors see it, its address on the site (D89). */
function Uses({ item }: { item: MediaItem }) {
  const w = useAdminText("website").media;
  if (item.uses.length === 0) return <p className="text-sm text-muted">{w.notUsedAnywhere}</p>;
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
              <span className="sr-only">{w.onSite}</span>
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
  const w = useAdminText("website").media;
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
          // A language the store keeps but does not show now (D178) keeps its text.
          const hidden = Object.fromEntries(Object.entries(item.altTranslations).filter(([locale]) => !languages.some((l) => l.locale === locale)));
          const outcome = await actions.describe(item.id, { alt, translations: { ...hidden, ...translations } });
          setStatus(outcome.ok ? { text: w.altSaved } : { text: w.altNotSaved, problem: true });
          if (outcome.ok) {
            setSource(Object.values(texts).some((text) => text.trim()) ? "staff" : null);
            router.refresh();
          }
        });
      }}
    >
      <div className="flex flex-wrap items-center gap-2">
        <h3 id={`${id}-heading`} className="text-body-strong text-ink">
          {w.altText}
        </h3>
        {source && (
          <span className="rounded-full bg-sunken px-2 py-0.5 text-xs text-muted">{source === "ai" ? w.byAi : w.byStaff}</span>
        )}
      </div>
      <p className="text-xs text-muted">{w.altHint}</p>
      {languages.map((language, index) => (
        <label key={language.locale} className="flex flex-col gap-1 text-sm">
          <span className="font-medium">
            {language.name}
            {languages.length > 1 && index === 0 ? w.mainLanguage : ""}
            {language.extra ? w.extraLanguage : ""}
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
            className="rounded-md border border-line bg-card px-3 py-2 text-sm font-normal"
          />
        </label>
      ))}
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" disabled={pending || writing || !changed} className={button}>
          {pending ? w.saving : w.saveAlt}
        </button>
        {altAi && (
          <button
            type="button"
            disabled={pending || writing}
            onClick={() =>
              write(async () => {
                setStatus({ text: w.aiLooking });
                const outcome = await actions.writeAlt(item.id);
                if (!outcome.ok) {
                  setStatus({ text: outcome.problem, problem: true });
                  return;
                }
                setTexts(textsOf(outcome.alt, outcome.translations));
                setSource("ai");
                setStatus({ text: w.aiWrote });
                router.refresh();
              })
            }
            className={button}
          >
            {writing ? w.writing : w.writeWithAi}
          </button>
        )}
        <p role="status" aria-live="polite" className={`text-sm ${status?.problem ? "text-danger-text" : ""}`}>
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
  const w = useAdminText("website").media;
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
      setProgress({ written, failed, remaining: 0, problem: w.runStopped });
    }
    setRunning(false);
    onChanged();
  };

  return (
    <section aria-label={w.altTextsLabel} className={`flex flex-col gap-2 p-4 ${CARD_CLASS}`}>
      <p className="text-sm">
        <span className="font-medium">{w.altTexts}</span>{" "}
        {missing === 0 ? w.everyHasAlt : countWords(missing, w.missingAlt)} {ai ? w.aiCan : w.aiCannot}
      </p>
      {ai && (
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            disabled={running || (missing === 0 && !rewrite)}
            onClick={() => void run()}
            className={`${button} bg-brand text-brand-ink`}
          >
            {running ? w.writingAlts : rewrite ? w.writeAlts : w.writeMissing}
          </button>
          {running ? (
            <button type="button" onClick={() => (stop.current = true)} className={button}>
              {w.stop}
            </button>
          ) : (
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={rewrite} onChange={(event) => setRewrite(event.target.checked)} />
              {w.rewrite}
            </label>
          )}
        </div>
      )}
      {progress && (
        <p role="status" aria-live="polite" className="text-sm">
          {running
            ? `${fillWords(w.writingProgress, { n: progress.written })}${progress.remaining > 0 ? fillWords(w.toGo, { n: progress.remaining }) : ""}.`
            : `${countWords(progress.written, w.written)}${progress.failed > 0 ? fillWords(w.couldNot, { n: progress.failed }) : ""}.`}
          {progress.problem && <span className="block text-danger-text">{progress.problem}</span>}
        </p>
      )}
    </section>
  );
}

type Job = { key: string; name: string; state: "waiting" | "uploading" | "done" | "failed"; problem?: string; note?: string };

/**
 * Adds files in bulk: dropped on it or chosen, several at once. Pictures and
 * videos are compressed in the browser as everywhere else (D213), each saying
 * what that saved, then uploaded; videos straight to Storage.
 */
function Uploader({ upload, startVideo, onDone }: { upload: Upload | null; startVideo: StartVideo | null; onDone: () => void }) {
  const w = useAdminText("website").media;
  const inputId = useId();
  const [jobs, setJobs] = useState<Job[]>([]);
  const [over, setOver] = useState(false);
  const busy = jobs.some((job) => job.state === "waiting" || job.state === "uploading");

  if (!upload) return <p className="rounded-panel border border-line p-4 text-sm text-muted">{w.uploadsOff}</p>;

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
        let outcome: { ok: true; note?: string } | { ok: false; problem: string };
        const noted = (saving: Saving) => savingWords(saving.before, saving.after, w) ?? undefined;
        if (IMAGE_TYPES.includes(file.type)) {
          try {
            const result = await uploadPicture(upload, file);
            outcome = result.ok ? { ok: true, note: noted(result.saving) } : result;
          } catch {
            outcome = { ok: false, problem: fillWords(w.notReadable, { name: file.name }) };
          }
        } else if (VIDEO_TYPES.includes(file.type) && startVideo) {
          const result = await uploadVideoFile(startVideo, null, file, {
            onProgress: (progress) => set(key, { note: progress < 1 ? fillWords(w.compressingPercent, { percent: Math.round(progress * 100) }) : undefined }),
          });
          outcome = result.ok ? { ok: true, note: noted(result.saving) } : result;
        } else {
          outcome = { ok: false, problem: w.wrongType };
        }
        set(key, outcome.ok ? { state: "done", note: outcome.note } : { state: "failed", problem: outcome.problem });
      }
    };
    await Promise.all(Array.from({ length: Math.min(AT_ONCE, batch.length) }, worker));
    onDone();
  };

  const done = jobs.filter((job) => job.state === "done").length;
  return (
    <section
      aria-label={w.addFiles}
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
      className={`flex flex-col gap-3 rounded-panel border-2 border-dashed p-6 text-center ${over ? "border-brand bg-sunken" : "border-line bg-card"}`}
    >
      <p className="font-medium">{w.drop}</p>
      <p className="text-sm text-muted">{w.dropHint}</p>
      <label htmlFor={inputId} className={`${button} mx-auto w-fit cursor-pointer content-center bg-brand text-brand-ink`}>
        {busy ? w.uploading : w.chooseFiles}
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
            {busy ? fillWords(w.uploadingDone, { done, of: jobs.length }) : countWords(done, w.added)}
          </p>
          <ul className="flex max-h-48 flex-col gap-1 overflow-y-auto">
            {jobs.map((job) => (
              <li key={job.key} className="flex items-center justify-between gap-3">
                <span className="truncate">{job.name}</span>
                <span className={job.state === "failed" ? "text-danger-text" : "text-muted"}>
                  {job.state === "waiting"
                    ? w.jobWaiting
                    : job.state === "uploading"
                      ? (job.note ?? w.jobUploading)
                      : job.state === "done"
                        ? job.note ? fillWords(w.jobAddedNote, { note: job.note }) : w.jobAdded
                        : job.problem}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
