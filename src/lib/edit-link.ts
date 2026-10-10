/**
 * What the browser and the server both need of the pass for changing words on a store's own domain (D193, `src/lib/edit-grant.ts`),
 * free of the signing so a page can import it: the times, where a person is sent back to, where the button starts, and the note the
 * browser keeps of having a pass.
 */

/** How long the redirect from the admin to a store's host works. */
export const ENTER_SECONDS = 90;
/** How long a person may go on changing words on a store's host before asking the admin again. */
export const EDIT_MINUTES = 30;

/** What the store's host is sent back with, so the page knows the pass was just given and turns editing on. */
export const EDIT_HASH = "#kaizen-edit";

/**
 * Where a person is taken back to on the store's host: a path of that host (never another address, never a way into the API), as the
 * browser had it. Null for anything else.
 */
export function backPath(value: string | null | undefined): string | null {
  if (typeof value !== "string" || value.length === 0 || value.length > 1500) return null;
  if (!value.startsWith("/") || value.startsWith("//") || /[\\\u0000-\u001f\u007f]/.test(value)) return null;
  let url: URL;
  try {
    url = new URL(value, "http://kaizen.invalid");
  } catch {
    return null;
  }
  if (url.origin !== "http://kaizen.invalid") return null;
  if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/_next/")) return null;
  return `${url.pathname}${url.search}`;
}

/** Where the "Edit text" button of a store's own domain starts: the admin's route that vouches for the person, with the page to come back to. */
export const grantUrl = (adminOrigin: string, store: string, path: string): string =>
  `${adminOrigin}/api/platform/editor/grant?store=${encodeURIComponent(store)}&to=${encodeURIComponent(path)}`;

// ---------------------------------------------------------------------------
// The note the browser keeps (local storage on the store's own host): that a pass was given, and until when
// ---------------------------------------------------------------------------

const KEY = "kaizen-edit";

type Passes = Record<string, number>;

function readPasses(): Passes {
  try {
    const value = JSON.parse(localStorage.getItem(KEY) ?? "{}") as unknown;
    return value && typeof value === "object" ? (value as Passes) : {};
  } catch {
    return {}; // Storage can be unavailable (private mode) or hold junk.
  }
}

/** Keeps that this browser was given a pass for the store, until it would run out. */
export function rememberEditPass(storeSlug: string, now = Date.now()): void {
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...readPasses(), [storeSlug]: now + EDIT_MINUTES * 60_000 }));
  } catch {
    // Nothing to keep it in.
  }
}

/** Whether this browser was given a pass for the store that has not run out. The pass itself is a cookie the page cannot read. */
export function editPassActive(storeSlug: string, now = Date.now()): boolean {
  const until = readPasses()[storeSlug];
  return typeof until === "number" && until > now;
}

export function forgetEditPass(storeSlug: string): void {
  try {
    const rest = readPasses();
    delete rest[storeSlug];
    localStorage.setItem(KEY, JSON.stringify(rest));
  } catch {
    // Nothing to forget.
  }
}
