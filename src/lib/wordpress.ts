/**
 * The WordPress plugin's rules (D169, `docs/wordpress-plugin.md`), pure: which site addresses may be connected, the return address of an
 * approval, the one-time code's proof, and the questions a view of products may ask. Nothing here reads the database or a request.
 */
import { createHash, timingSafeEqual } from "node:crypto";

import { z } from "zod";

/** Every token starts so, so a leaked one is found by a secret scanner and a wrong one is refused before a lookup. */
export const TOKEN_PREFIX = "kzwp_";
export const CODE_PREFIX = "kzwc_";
/** How long an approval's code can be swapped for a token. */
export const CODE_MINUTES = 5;
/** Most products one view returns (the grid's own cap, D51). */
export const VIEW_MAX = 48;
export const VIEW_DEFAULT = 12;
/** Most hand-picked products in one view. */
export const PICK_MAX = 48;
/** Calls one connection may make in a clock hour: a page cached for ten minutes asks a handful of times. */
export const CALLS_PER_HOUR = 1500;
/** Swaps of a code for a token, in all, in a clock hour: a code is 160 random bits, so this only stops noise. */
export const EXCHANGES_PER_HOUR = 120;

const SECRET = /^[A-Za-z0-9_-]{30,80}$/;

/** The SHA-256 of a secret, as hex: what is kept of a code, a token and the plugin's verifier. */
export const hashSecret = (secret: string): string => createHash("sha256").update(secret).digest("hex");

/** The code challenge of a verifier (S256, base64url), the same the plugin works out. */
export const challengeOf = (verifier: string): string => createHash("sha256").update(verifier).digest("base64url");

/** Whether `verifier` is the one `challenge` was made from, in constant time. */
export function verifierMatches(verifier: string, challenge: string): boolean {
  if (!SECRET.test(verifier) || !SECRET.test(challenge)) return false;
  const a = Buffer.from(challengeOf(verifier));
  const b = Buffer.from(challenge);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Whether a string could be a token or a code of ours (shape only), before any lookup. */
export const looksLikeToken = (value: string): boolean => /^kzwp_[A-Za-z0-9_-]{40,60}$/.test(value);
export const looksLikeCode = (value: string): boolean => /^kzwc_[A-Za-z0-9_-]{40,60}$/.test(value);

/** Hosts a plugin may reach over plain http: a developer's own machine, never the internet. */
const LOCAL_HOST = /^(localhost|127\.0\.0\.1|\[::1\])$|\.(localhost|local|test)$/i;

/**
 * A site's origin from the address the plugin gave: `https` (plain `http` only on a developer's own host), a host, an optional port,
 * no user name or password, no path, query or fragment kept. Null for anything else.
 */
export function siteOrigin(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 300) return null;
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    return null;
  }
  if (url.username || url.password || !url.hostname) return null;
  const local = LOCAL_HOST.test(url.hostname);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && local)) return null;
  return url.origin;
}

/**
 * Where an approval sends the person back to: an address on the same site (same origin), with no fragment. The plugin's admin page,
 * so the code can only ever reach the site that asked. Null for any other.
 */
export function returnAddress(site: string, value: unknown): URL | null {
  if (typeof value !== "string" || value.length > 1000) return null;
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    return null;
  }
  if (url.origin !== site || url.username || url.password) return null;
  url.hash = "";
  return url;
}

/** A name for the site as the owner will see it in their list: the plugin's, trimmed, plain text, at most 120 characters. */
export function siteLabel(value: unknown, fallback: string): string {
  const text = typeof value === "string" ? value.replace(/[\u0000-\u001f\u007f<>]/g, " ").replace(/\s+/g, " ").trim().slice(0, 120) : "";
  return text || fallback;
}

/** What an approval asks for, as the plugin's address carries it. */
export type ApprovalRequest = { site: string; name: string; returnTo: URL; state: string; challenge: string };

/** The approval page's query read into a request, or why it is not one. */
export function readApproval(query: Record<string, string | string[] | undefined>): { ok: true; request: ApprovalRequest } | { ok: false; reason: string } {
  const one = (key: string) => {
    const value = query[key];
    return typeof value === "string" ? value : undefined;
  };
  const site = siteOrigin(one("site"));
  if (!site) return { ok: false, reason: "The site's address is missing, or is not an https address." };
  const returnTo = returnAddress(site, one("return"));
  if (!returnTo) return { ok: false, reason: "The return address does not belong to the site." };
  const state = one("state") ?? "";
  if (!/^[A-Za-z0-9_-]{16,128}$/.test(state)) return { ok: false, reason: "The request has no valid state." };
  const challenge = one("challenge") ?? "";
  if (!SECRET.test(challenge)) return { ok: false, reason: "The request has no valid code challenge." };
  return { ok: true, request: { site, name: siteLabel(one("name"), new URL(site).host), returnTo, state, challenge } };
}

/** The address an approval, or a refusal, sends the person to: the return address with the answer in its query. */
export function approvalLocation(request: Pick<ApprovalRequest, "returnTo" | "state">, answer: { code: string } | { error: "denied" }): string {
  const url = new URL(request.returnTo);
  url.searchParams.set("kaizen_state", request.state);
  if ("code" in answer) url.searchParams.set("kaizen_code", answer.code);
  else url.searchParams.set("kaizen_error", answer.error);
  return url.toString();
}

export const VIEW_SORTS = ["newest", "oldest", "title", "priceLow", "priceHigh", "given"] as const;
export const VIEW_SOURCES = ["all", "category", "tag", "products"] as const;

const idList = z
  .string()
  .max(2000)
  .transform((text) => text.split(",").map((part) => part.trim()).filter(Boolean))
  .pipe(z.array(z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)).max(PICK_MAX));

/**
 * The questions a view of products may ask (the query of `/stores/{slug}/view`): where the products come from, in what order, how many,
 * and in which of the store's markets they are priced. The plugin saves these with its shortcode and sends them again.
 */
export const viewQuery = z
  .object({
    market: z.string().max(40).regex(/^[a-z0-9-]*$/i).optional(),
    source: z.enum(VIEW_SOURCES).default("all"),
    categories: idList.optional(),
    tags: idList.optional(),
    ids: idList.optional(),
    sort: z.enum(VIEW_SORTS).default("newest"),
    limit: z.coerce.number().int().min(1).max(VIEW_MAX).default(VIEW_DEFAULT),
  })
  .transform((view) => ({
    ...view,
    // Only what the source uses is kept, so a view's cache key and answer follow its source alone.
    categories: view.source === "category" ? (view.categories ?? []) : [],
    tags: view.source === "tag" ? (view.tags ?? []) : [],
    ids: view.source === "products" ? (view.ids ?? []) : [],
    // Hand-picked products keep the order they were picked in; the others never use it.
    sort: view.source === "products" ? ("given" as const) : view.sort === "given" ? ("newest" as const) : view.sort,
  }));

export type ViewQuery = z.output<typeof viewQuery>;

/** Whether a view that names its source names something: a category or tag view with none, or hand-picked with none, would show everything by mistake. */
export function viewIsComplete(view: ViewQuery): boolean {
  if (view.source === "category") return view.categories.length > 0;
  if (view.source === "tag") return view.tags.length > 0;
  if (view.source === "products") return view.ids.length > 0;
  return true;
}
