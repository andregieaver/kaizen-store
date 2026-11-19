/**
 * Unsaved work kept in this browser (code review 1.16, D787). The page builder and the product editor write what they hold to
 * `localStorage` a moment after each change, per store and per page or product, and offer *Restore unsaved changes* when they open
 * on it again, after a crash, a closed tab, a session that timed out or a click that left. Only onto the very version a draft was
 * made from (`base`): once the saved version has moved on (someone saved since), the draft is dropped, never restored over the later
 * save. A save clears it, and so does leaving on purpose (`useBrowserDraft`). Storage may be full, blocked or missing (a private
 * window): every read and write is tried, and the editor works the same without it. Pure but for the storage handed in.
 */

const PREFIX = "kaizen:draft:";
/** How long a draft is kept for an editor that is not opened again: two weeks. */
const KEPT_MS = 14 * 24 * 60 * 60 * 1000;
/** A draft's text starts with its version and its time, so its age is read without reading the rest. */
const HEAD = /^\{"v":1,"at":(\d+),/;

/** A draft as kept: when it was written, the saved version it was made from, and what the editor held. */
export type StoredDraft<T> = { v: 1; at: number; base: string; value: T };

export type DraftStorage = Pick<Storage, "getItem" | "setItem" | "removeItem" | "key" | "length">;

/** The browser's storage, or null where even reaching it throws (storage blocked in the person's settings). */
export function browserStorage(): DraftStorage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

/** The key a draft is kept under: the editor, then whose and which document, as `kaizen:draft:page:{owner}:{type}:{id}`. */
export function draftKey(editor: "page" | "product", ...parts: string[]): string {
  return `${PREFIX}${editor}:${parts.join(":")}`;
}

/** JSON with every object's keys in order, so the same content always reads the same, however it was put together. */
export function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, item: unknown) =>
    item && typeof item === "object" && !Array.isArray(item)
      ? Object.fromEntries(Object.entries(item as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
      : item,
  );
}

/** A short stamp of a text (FNV-1a and its length), to tell one saved version from another without keeping it. */
export function fingerprint(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return `${(hash >>> 0).toString(36)}.${text.length.toString(36)}`;
}

function parse<T>(raw: string): StoredDraft<T> | null {
  try {
    const draft = JSON.parse(raw) as Partial<StoredDraft<T>> | null;
    if (!draft || draft.v !== 1 || typeof draft.at !== "number" || typeof draft.base !== "string" || !("value" in draft)) return null;
    return draft as StoredDraft<T>;
  } catch {
    return null;
  }
}

/**
 * The draft kept under `key` that the editor may offer to restore, or null. A draft that cannot be read, is past two weeks, was made
 * from another saved version than `base`, or holds just what the editor opened with (`opened`, asked only then) is removed.
 */
export function readDraft<T>(storage: DraftStorage | null, key: string, base: string, opened: () => unknown, now: number): StoredDraft<T> | null {
  if (!storage) return null;
  let raw: string | null;
  try {
    raw = storage.getItem(key);
  } catch {
    return null;
  }
  if (raw === null) return null;
  const draft = parse<T>(raw);
  if (draft && now - draft.at <= KEPT_MS && draft.base === base && canonical(draft.value) !== canonical(opened())) return draft;
  removeDraft(storage, key);
  return null;
}

/** Keeps what the editor holds. When storage is full, the other drafts make room (this one is the work in hand) and it is tried again. */
export function writeDraft(storage: DraftStorage | null, key: string, base: string, value: unknown, now: number): boolean {
  if (!storage) return false;
  let text: string;
  try {
    text = JSON.stringify({ v: 1, at: now, base, value });
  } catch {
    return false;
  }
  for (const last of [false, true]) {
    try {
      storage.setItem(key, text);
      return true;
    } catch {
      if (!last) pruneDrafts(storage, now, key);
    }
  }
  return false;
}

export function removeDraft(storage: DraftStorage | null, key: string): void {
  try {
    storage?.removeItem(key);
  } catch {
    // Storage refused: the draft stays until it is past two weeks or read as stale.
  }
}

/**
 * Removes the drafts past two weeks or unreadable; with `keep`, every other draft (storage is full, and the work in hand comes first);
 * with `keep` null and `all`, every draft (signing out).
 */
export function pruneDrafts(storage: DraftStorage | null, now: number, keep?: string | null, all = false): void {
  if (!storage) return;
  try {
    const keys: string[] = [];
    for (let i = 0; i < storage.length; i++) {
      const key = storage.key(i);
      if (key !== null && key.startsWith(PREFIX) && key !== keep) keys.push(key);
    }
    for (const key of keys) {
      const at = all || keep ? null : HEAD.exec(storage.getItem(key) ?? "");
      if (!at || now - Number(at[1]) > KEPT_MS) storage.removeItem(key);
    }
  } catch {
    // Storage refused: nothing more to do.
  }
}

/** Signing out forgets every draft kept in this browser, so the next person at a shared computer finds none. */
export function forgetDrafts(): void {
  pruneDrafts(browserStorage(), Date.now(), null, true);
}
