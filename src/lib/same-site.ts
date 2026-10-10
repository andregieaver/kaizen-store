/**
 * A request from another site is refused: the routes that act for a signed-in person, or for a visitor on the site's own pages, are for
 * the site's own pages. The request's `Origin` must be this host; without one (a plain request, not a page's) it must not say it comes
 * from another site (`Sec-Fetch-Site`).
 */
export function sameSite(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return request.headers.get("sec-fetch-site") !== "cross-site";
  try {
    return new URL(origin).host === (request.headers.get("x-forwarded-host") ?? request.headers.get("host"));
  } catch {
    return false;
  }
}
