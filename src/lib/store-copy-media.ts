/**
 * Pictures and files in a store copy (D129): pure helpers for finding every address in Storage that belongs to the
 * original store's folder, and for rewriting the copy's content to the new store's own files. Nothing here reads a
 * database or Storage; `src/server/store-copy-media.ts` does the copying with these.
 *
 * A file of a store lies in a public bucket under the store's id (`{bucket}/{storeId}/…`), whoever uploaded it
 * (`uploadProductImage()`, `startVideoUpload()` and `startFieldFileUpload()` all name that folder). Anything else,
 * another site's picture or a Kaizen demo file, is not the original's to hand over and stays as it is.
 */

/** The public buckets whose files are copied. Downloads (private) and profile pictures stay with the original. */
export const COPYABLE_BUCKETS = ["product-media", "page-videos", "field-files"] as const;
export type CopyableBucket = (typeof COPYABLE_BUCKETS)[number];

const STORAGE_PATH = "/storage/v1/object/public/";

export type StorageRef = { bucket: string; path: string };

/** The bucket and path an address in Storage's public buckets names, or null for any other address. */
export function storageRef(url: string): StorageRef | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (!/^https?:$/.test(parsed.protocol) || !parsed.pathname.startsWith(STORAGE_PATH)) return null;
  const rest = decodeURIComponent(parsed.pathname.slice(STORAGE_PATH.length));
  const slash = rest.indexOf("/");
  if (slash <= 0 || slash === rest.length - 1) return null;
  return { bucket: rest.slice(0, slash), path: rest.slice(slash + 1) };
}

/** Whether an address is a file in the store's own folder of a public bucket. */
export function isStoreFile(url: string, storeId: string): boolean {
  const ref = storageRef(url);
  return ref !== null && ref.path.startsWith(`${storeId.toLowerCase()}/`);
}

const escapeRegex = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** A pattern matching every address of a file in the store's folder inside any text (JSON, CSS, HTML). */
function storeFilePattern(storeId: string): RegExp {
  return new RegExp(
    `https?://[^\\s"'<>()\\\\]+${escapeRegex(STORAGE_PATH)}[A-Za-z0-9_-]+/${escapeRegex(storeId.toLowerCase())}/[^\\s"'<>()\\\\]+`,
    "gi",
  );
}

/** Every address of a file in the store's folder in a text, once each, in the order they appear. */
export function storeFileUrlsIn(text: string, storeId: string): string[] {
  return [...new Set(text.match(storeFilePattern(storeId)) ?? [])];
}

/** Every such address in a value of any shape (its strings, keys aside), once each. */
export function storeFileUrls(value: unknown, storeId: string): string[] {
  const found = new Set<string>();
  const visit = (node: unknown) => {
    if (typeof node === "string") {
      if (node.includes(storeId.toLowerCase())) for (const url of storeFileUrlsIn(node, storeId)) found.add(url);
    } else if (Array.isArray(node)) node.forEach(visit);
    else if (typeof node === "object" && node !== null) Object.values(node).forEach(visit);
  };
  visit(value);
  return [...found];
}

/** What to put where an address was: the new address, or null when the file could not be copied (leave it out). */
export type FileResolver = (url: string) => string | null;

const REMOVED = Symbol("removed");

/**
 * A value with every address of a file in the original's folder replaced by the copy's (`resolve`). What cannot
 * be replaced is left out, never left pointing at the original: a picture or video (an object whose `url` is
 * one) goes whole, a list loses the item, an object the member, and a text (CSS, HTML) the address. Addresses
 * that are not in the original's folder are not asked about and stay. Returns a new value; the input is not
 * changed. A root that is left out is `null`.
 */
export function rewriteFiles<T>(value: T, storeId: string, resolve: FileResolver): T | null {
  const id = storeId.toLowerCase();
  const walk = (node: unknown): unknown => {
    if (typeof node === "string") {
      if (!node.includes(id)) return node;
      if (isStoreFile(node, id) && !/\s/.test(node)) return resolve(node) ?? REMOVED;
      return node.replace(storeFilePattern(id), (url) => resolve(url) ?? "");
    }
    if (Array.isArray(node)) {
      const out: unknown[] = [];
      for (const item of node) {
        const next = walk(item);
        if (next !== REMOVED) out.push(next);
      }
      return out;
    }
    if (typeof node === "object" && node !== null) {
      const record = node as Record<string, unknown>;
      if (typeof record.url === "string" && isStoreFile(record.url, id) && resolve(record.url) === null) return REMOVED;
      const out: Record<string, unknown> = {};
      for (const [key, member] of Object.entries(record)) {
        const next = walk(member);
        if (next !== REMOVED) out[key] = next;
      }
      return out;
    }
    return node;
  };
  const result = walk(value);
  return result === REMOVED ? null : (result as T);
}

/** A file's name, the last part of its path. */
export const fileNameOf = (path: string): string => path.slice(path.lastIndexOf("/") + 1);

const extensionOf = (path: string): string => path.match(/\.[A-Za-z0-9]{1,5}$/)?.[0] ?? "";

/**
 * Where the copy of a file goes in its bucket: the new store's folder and a name of its own. A custom field's
 * file keeps its readable name after the new one (`isOwnFieldFile()` wants one level under the folder).
 */
export function copyPathFor(ref: StorageRef, newStoreId: string, name: string): string {
  if (ref.bucket === "field-files") {
    const readable = fileNameOf(ref.path).replace(/^[0-9a-f-]{36}-/i, "");
    return `${newStoreId}/${name}-${readable}`;
  }
  return `${newStoreId}/${name}${extensionOf(ref.path)}`;
}

const TYPES: Record<string, string> = {
  ".webp": "image/webp",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".avif": "image/avif",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
};

/** A media type from a file name, for a file the library never registered. */
export const contentTypeOf = (path: string): string =>
  TYPES[extensionOf(path).toLowerCase()] ?? "application/octet-stream";

/** The kind a library item of that file is: a video or a picture. */
export const mediaKindOf = (path: string): "image" | "video" =>
  contentTypeOf(path).startsWith("video/") ? "video" : "image";
