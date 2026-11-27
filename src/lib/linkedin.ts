/**
 * LinkedIn for the social media manager (D870 S3.6, `docs/social-manager.md` 6): LinkedIn's sign-in address, its tokens (an access token for
 * 60 days, renewed with a refresh token only where LinkedIn gives one), the places a post may go (the member's own profile, and the Company
 * Pages they administer once Kaizena Flow's app has LinkedIn's Community Management API), and a post made through LinkedIn's Posts API: its
 * words, its picture uploaded through the Images API, public in the feed. Pure; the server is `src/server/linkedin.ts`.
 *
 * Only the member's name and their Pages' names are read: never who saw or liked a post.
 */

export const LINKEDIN_API = "https://api.linkedin.com";
/** The Posts API's version (`LinkedIn-Version`, a month LinkedIn still serves); `LINKEDIN_API_VERSION` overrides it. */
export const LINKEDIN_VERSION = "202510";
/** Posting to the member's own profile, and their name. */
export const LINKEDIN_MEMBER_SCOPES = ["openid", "profile", "w_member_social"] as const;
/** Posting to a Company Page the member administers: only once LinkedIn has given the app the Community Management API. */
export const LINKEDIN_PAGE_SCOPES = ["r_organization_admin", "w_organization_social"] as const;
/** The access token is renewed (or the owner asked to connect again) when it ends within this many days. */
export const LINKEDIN_RENEW_DAYS = 7;
/** LinkedIn takes this many characters of words in a post. */
export const LINKEDIN_TEXT_MAX = 3000;

/** Where the owner signs in with LinkedIn: the profile's scopes, and the Pages' too where the app may ask for them. */
export function linkedinAuthorizeUrl(clientId: string, redirectUri: string, state: string, pages: boolean): string {
  const scope = [...LINKEDIN_MEMBER_SCOPES, ...(pages ? LINKEDIN_PAGE_SCOPES : [])].join(" ");
  const params = new URLSearchParams({ response_type: "code", client_id: clientId, redirect_uri: redirectUri, state, scope });
  return `https://www.linkedin.com/oauth/v2/authorization?${params}`;
}

export type LinkedinTokens = { access: string; refresh: string | null; expiresAt: Date; refreshExpiresAt: Date | null; scopes: string[] };

/** The tokens in LinkedIn's answer to a code or a renewal; null when it gave none. A renewal without a new refresh token keeps the one given. */
export function parseTokens(json: unknown, now: Date, kept: { refresh: string; refreshExpiresAt: Date | null } | null = null): LinkedinTokens | null {
  const r = json as Record<string, unknown> | null;
  const access = typeof r?.access_token === "string" && r.access_token.length > 0 ? r.access_token : null;
  const seconds = typeof r?.expires_in === "number" && r.expires_in > 0 ? r.expires_in : null;
  if (!access || !seconds) return null;
  const refresh = typeof r?.refresh_token === "string" && r.refresh_token.length > 0 ? r.refresh_token : (kept?.refresh ?? null);
  const refreshSeconds = typeof r?.refresh_token_expires_in === "number" && r.refresh_token_expires_in > 0 ? r.refresh_token_expires_in : null;
  return {
    access,
    refresh,
    expiresAt: new Date(now.getTime() + seconds * 1000),
    refreshExpiresAt: refreshSeconds ? new Date(now.getTime() + refreshSeconds * 1000) : refresh ? (kept?.refreshExpiresAt ?? null) : null,
    scopes: typeof r?.scope === "string" ? r.scope.split(/[,\s]+/).filter(Boolean) : [],
  };
}

/** Whether the access token is due for renewal. */
export const renewDue = (expiresAt: Date, now: Date): boolean => expiresAt.getTime() - now.getTime() < LINKEDIN_RENEW_DAYS * 86_400_000;

export type AuthorChoice = { urn: string; name: string };

const AUTHOR = /^urn:li:(person|organization):[A-Za-z0-9_-]{1,64}$/;
export const isAuthorUrn = (urn: string): boolean => AUTHOR.test(urn);

/** The member as an author, from `/v2/userinfo` (OpenID): their id (`sub`) and name; null without an id. */
export function memberFrom(json: unknown): AuthorChoice | null {
  const r = json as Record<string, unknown> | null;
  const id = typeof r?.sub === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(r.sub) ? r.sub : null;
  if (!id) return null;
  const name = typeof r?.name === "string" ? r.name.replace(/\s+/g, " ").trim().slice(0, 200) : "";
  return { urn: `urn:li:person:${id}`, name: name || "LinkedIn profile" };
}

/** The Company Pages the member administers, from `/rest/organizationAcls`: their ids; at most 20. */
export function organizationIds(json: unknown): string[] {
  const elements = (json as { elements?: unknown })?.elements;
  if (!Array.isArray(elements)) return [];
  const ids = (elements as Record<string, unknown>[]).flatMap((e) => {
    const urn = typeof e?.organization === "string" ? e.organization : "";
    const id = urn.match(/^urn:li:organization:([0-9]{1,20})$/)?.[1];
    return id && e.state !== "REVOKED" ? [id] : [];
  });
  return [...new Set(ids)].slice(0, 20);
}

/** A Company Page as an author, from `/rest/organizations/{id}`. */
export function organizationFrom(id: string, json: unknown): AuthorChoice {
  const name = (json as { localizedName?: unknown } | null)?.localizedName;
  return { urn: `urn:li:organization:${id}`, name: typeof name === "string" && name.trim() ? name.trim().slice(0, 200) : `Page ${id}` };
}

/** Whether the token may post as this author: the profile with `w_member_social`, a Page with `w_organization_social`. */
export function grantsPosting(scopes: readonly string[], authorUrn: string): boolean {
  return authorUrn.startsWith("urn:li:organization:") ? scopes.includes("w_organization_social") : scopes.includes("w_member_social");
}

/** Where the picture goes and the image's urn, from `images?action=initializeUpload`; null when LinkedIn gave neither. */
export function parseImageUpload(json: unknown): { uploadUrl: string; image: string } | null {
  const value = (json as { value?: Record<string, unknown> } | null)?.value;
  const uploadUrl = typeof value?.uploadUrl === "string" && value.uploadUrl.startsWith("https://") ? value.uploadUrl : null;
  const image = typeof value?.image === "string" && /^urn:li:image:[A-Za-z0-9_-]{1,100}$/.test(value.image) ? value.image : null;
  return uploadUrl && image ? { uploadUrl, image } : null;
}

/** The post: its words, public in the main feed, with the picture where it has one. */
export function postBody(author: string, text: string, image: string | null, altText: string) {
  return {
    author,
    commentary: text.slice(0, LINKEDIN_TEXT_MAX),
    visibility: "PUBLIC",
    distribution: { feedDistribution: "MAIN_FEED", targetEntities: [], thirdPartyDistributionChannels: [] },
    ...(image ? { content: { media: { id: image, altText: altText.slice(0, 300) } } } : {}),
    lifecycleState: "PUBLISHED",
    isReshareDisabledByAuthor: false,
  };
}

/** The post's urn from the `x-restli-id` header LinkedIn answers a new post with; null when it is not one. */
export const postUrnFrom = (header: string | null): string | null =>
  header && /^urn:li:(share|ugcPost):[0-9]{1,30}$/.test(header) ? header : null;

/** The post's own address. */
export const postUrl = (urn: string): string => `https://www.linkedin.com/feed/update/${urn}/`;
