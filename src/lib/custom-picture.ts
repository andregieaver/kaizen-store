/**
 * Where a custom grid item's picture may come from (D155): the site's own library or the site itself, never another site.
 * A picture on a third party's server is fetched straight from it by every visitor's browser, with no consent: it tells
 * that party the visitor's address and the page they are on (a tracking pixel), and an `http:` one is mixed content. So an
 * item's picture is one of:
 *
 * - a file in the media library: an `https:` address in Supabase Storage's public buckets, on this project's own origin
 *   (`NEXT_PUBLIC_SUPABASE_URL`) where that is known;
 * - a path on the site (`/demo/mug.svg`), which is the site's own file.
 *
 * Pure and free of other modules, so the page's schema (shared with the browser), the snapshot of a grid's items and
 * the template copy all ask the same question.
 */

const STORAGE_PATH = "/storage/v1/object/public/";
const INVALID = "An item's picture has an invalid address.";
const FOREIGN = "An item's picture must be a file from your media library or this site, not another site's.";

/** Why an address is not a picture a custom item may use, or null when it is. `library` is the origin of the media library, when known. */
export function customPictureProblem(value: string, library: string | null | undefined = ownLibraryOrigin()): string | null {
  const url = value.trim();
  if (url === "" || url.length > 1000) return INVALID;
  // A path on the site; `//host/…` and `/\host` leave it.
  if (url.startsWith("/")) return /^\/(?![/\\])[^\s\\]*$/.test(url) && !/(^|\/)\.\.(\/|$)/.test(url) ? null : INVALID;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return INVALID;
  }
  if (parsed.username !== "" || parsed.password !== "") return INVALID;
  if (parsed.protocol !== "https:" || !parsed.pathname.startsWith(STORAGE_PATH) || (library && parsed.origin !== library)) return FOREIGN;
  return null;
}

/** Whether a custom item may draw this picture. */
export const isCustomPicture = (value: string, library?: string | null): boolean => customPictureProblem(value, library) === null;

/** This project's media library's origin, or null where it is not set (a unit test): the check then falls back to the path alone. */
function ownLibraryOrigin(): string | null {
  const configured = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!configured) return null;
  try {
    return new URL(configured).origin;
  } catch {
    return null;
  }
}
