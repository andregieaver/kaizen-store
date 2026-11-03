import { OAUTH_PATHS } from "@/lib/oauth";

/**
 * The authorization endpoint's address in the metadata (RFC 8414, D439): the request, unchanged, goes on to the consent page in the admin's
 * own frame (`/admin/oauth/authorize`), where a person signs in first if they must and comes back.
 */
export function GET(request: Request) {
  const url = new URL(request.url);
  return new Response(null, {
    status: 307,
    headers: { Location: `/admin${OAUTH_PATHS.authorize}${url.search}`, "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" },
  });
}
