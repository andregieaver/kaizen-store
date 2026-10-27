/**
 * Preview links (wave 7 unit F, D340, `docs/wave-7-storefront.md` F): a link that opens one unpublished page's draft or one installed theme
 * without signing in, until it expires or is revoked. The rules a form and the server share; the token itself is `preview-token.ts`
 * (server only). Pure.
 */

/** How long a link may be good for, in days: the choices offered, the one chosen to start with, and the most the database allows. */
export const PREVIEW_DAY_CHOICES = [1, 7, 30] as const;
export const PREVIEW_DEFAULT_DAYS = 7;
export const PREVIEW_MAX_DAYS = 30;
/** How many links that are still good one page or theme may have at once. */
export const PREVIEW_LINKS_PER_TARGET = 10;

/** The address a token opens, on the admin's own host (`/admin/account/share/{token}`). */
export const previewPath = (token: string): string => `/admin/account/share/${token}`;

/** The days a link is good for, from what a form sent: one of the choices, else the default. */
export function previewDays(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  return (PREVIEW_DAY_CHOICES as readonly number[]).includes(n) ? n : PREVIEW_DEFAULT_DAYS;
}

/** A link as the person who shares sees it (never its token, which is shown once when made). */
export type PreviewLinkItem = { id: string; createdAt: string; expiresAt: string; by: string | null; live: boolean; revokedAt: string | null };

/** What making or revoking a link answers: the address to copy (shown this once, when made) and the list as it is now. */
export type PreviewLinkAnswer = { ok: true; url: string | null; links: PreviewLinkItem[]; message: string } | { ok: false; problem: string };
