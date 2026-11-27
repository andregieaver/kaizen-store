/**
 * Pinterest for the social media manager (D870 S3.4, `docs/social-manager.md` 6): Pinterest's sign-in address, its tokens (an access token for
 * 30 days, renewed with the refresh token before it ends), the person's boards, and a Pin made from an approved post: its picture, its
 * title, its words and its tagged link (a Pin opens its link, unlike a post on Instagram). Pure; the server is `src/server/pinterest.ts`.
 *
 * Only the account's name and its boards' names are read: never who saved or saw a Pin.
 */

import type { PostChannel } from "./social-posts";

export const PINTEREST_API = "https://api.pinterest.com/v5";
export const PINTEREST_SCOPES = ["boards:read", "pins:read", "pins:write", "user_accounts:read"] as const;
/** The access token is renewed when it ends within this many days. */
export const PINTEREST_RENEW_DAYS = 3;

/** Where the owner signs in with Pinterest and allows Kaizena Flow to read their boards and make Pins. */
export function pinterestAuthorizeUrl(appId: string, redirectUri: string, state: string): string {
  const params = new URLSearchParams({ client_id: appId, redirect_uri: redirectUri, response_type: "code", scope: PINTEREST_SCOPES.join(","), state });
  return `https://www.pinterest.com/oauth/?${params}`;
}

export type PinterestTokens = { access: string; refresh: string; expiresAt: Date; refreshExpiresAt: Date; scopes: string[] };

/**
 * The tokens in Pinterest's answer to a code or a renewal. A renewal may leave out a new refresh token: the one given (`keptRefresh`) stays,
 * with its end.
 */
export function parseTokens(json: unknown, now: Date, kept: { refresh: string; refreshExpiresAt: Date } | null = null): PinterestTokens | null {
  const r = json as Record<string, unknown> | null;
  const access = typeof r?.access_token === "string" && r.access_token.length > 0 ? r.access_token : null;
  const refresh = typeof r?.refresh_token === "string" && r.refresh_token.length > 0 ? r.refresh_token : (kept?.refresh ?? null);
  const seconds = typeof r?.expires_in === "number" && r.expires_in > 0 ? r.expires_in : null;
  if (!access || !refresh || !seconds) return null;
  const refreshSeconds = typeof r?.refresh_token_expires_in === "number" && r.refresh_token_expires_in > 0 ? r.refresh_token_expires_in : null;
  const refreshExpiresAt = refreshSeconds ? new Date(now.getTime() + refreshSeconds * 1000) : (kept?.refreshExpiresAt ?? new Date(now.getTime() + 365 * 86_400_000));
  const scopes = typeof r?.scope === "string" ? r.scope.split(/[,\s]+/).filter(Boolean) : [];
  return { access, refresh, expiresAt: new Date(now.getTime() + seconds * 1000), refreshExpiresAt, scopes };
}

/** Whether the person allowed making Pins. */
export const grantsPins = (scopes: readonly string[]): boolean => scopes.includes("pins:write");

/** Whether the access token is due for renewal. */
export const renewDue = (expiresAt: Date, now: Date): boolean => expiresAt.getTime() - now.getTime() < PINTEREST_RENEW_DAYS * 86_400_000;

export type BoardChoice = { id: string; name: string };

const BOARD_ID = /^[0-9]{1,40}$/;

/** The person's boards a Pin may go to (not their secret ones, which nobody else sees), from `/boards`; at most 100. */
export function parseBoards(json: unknown): BoardChoice[] {
  const items = (json as { items?: unknown })?.items;
  if (!Array.isArray(items)) return [];
  return (items as Record<string, unknown>[])
    .flatMap((b) => {
      const id = typeof b?.id === "string" && BOARD_ID.test(b.id) ? b.id : null;
      const name = typeof b?.name === "string" ? b.name.replace(/\s+/g, " ").trim().slice(0, 180) : "";
      return id && b.privacy !== "SECRET" ? [{ id, name: name || id }] : [];
    })
    .slice(0, 100);
}

/** The boards kept for the owner to choose from, from the row. */
export function keptBoards(json: unknown): BoardChoice[] {
  if (!Array.isArray(json)) return [];
  return (json as Record<string, unknown>[]).flatMap((c) =>
    typeof c?.id === "string" && BOARD_ID.test(c.id) && typeof c.name === "string" ? [{ id: c.id, name: c.name.slice(0, 180) }] : [],
  );
}

/** The account's name from `/user_account`. */
export const usernameFrom = (json: unknown): string => {
  const name = (json as { username?: unknown } | null)?.username;
  return typeof name === "string" ? name.slice(0, 100) : "";
};

type PinPost = { channel: PostChannel; title: string; caption: string; hashtags: readonly string[]; link: string; priceLine: string | null };

/**
 * The Pin made from a post: its title (100 characters), its words with the price line and hashtags (800), its link and its picture, or a
 * carousel Pin of up to five pictures (S2.1b), each with the post's link.
 */
export function pinBody(boardId: string, post: PinPost, imageUrl: string | readonly string[]) {
  const tags = post.hashtags.map((t) => `#${t}`).join(" ");
  const description = [post.caption, post.priceLine ?? "", tags].filter(Boolean).join("\n\n").slice(0, 800);
  return {
    board_id: boardId,
    title: post.title.slice(0, 100),
    description,
    link: post.link,
    alt_text: (post.title || post.caption).slice(0, 500),
    media_source:
      typeof imageUrl === "string"
        ? { source_type: "image_url", url: imageUrl }
        : { source_type: "multiple_image_urls", items: imageUrl.slice(0, 5).map((url) => ({ url, title: post.title.slice(0, 100), link: post.link })) },
  };
}

/** The Pin's id from Pinterest's answer, or null. */
export const pinIdFrom = (json: unknown): string | null => {
  const id = (json as { id?: unknown } | null)?.id;
  return typeof id === "string" && /^[0-9]{1,40}$/.test(id) ? id : null;
};

/** The Pin's own address. */
export const pinUrl = (id: string): string => `https://www.pinterest.com/pin/${id}/`;
