/**
 * Kaizena Flow's OAuth 2.1 authorization server (wave 14 unit B, D439, `docs/wave-14-developer-platform.md` B1 to B5), the pure part: the
 * scopes and access levels, the redirect URI rules (RFC 8252), a client's metadata document (Client ID Metadata Documents, MCP 2026-07-28),
 * the discovery documents (RFC 8414, RFC 9728), the authorization request's checks and the `insufficient_scope` challenge (RFC 6750). No
 * imports beyond the permission keys, so the consent screen's client part can read the scopes and levels too; PKCE, which hashes, is
 * `oauth-pkce.ts`. The server is `src/server/oauth.ts` (grants and tokens) and `src/server/oauth-clients.ts` (clients).
 */
import { AREAS, PERMISSION_KEYS, type PermissionKey } from "./permission-keys";

// ---------------------------------------------------------------------------------------------------------------------------------
// Scopes and access levels (B3)
// ---------------------------------------------------------------------------------------------------------------------------------

/** Listing the stores and what each offers: every grant holds it. */
export const STORES_READ = "stores:read" as const;

/** A scope: one per staff permission key (D158), as `TOOL_PERMISSIONS` and the Admin API name them, plus `stores:read`. */
export type OAuthScope = typeof STORES_READ | PermissionKey;

/** Every scope, in the order the consent screen and the metadata list them. */
export const OAUTH_SCOPES: readonly OAuthScope[] = [STORES_READ, ...PERMISSION_KEYS];

export const isOAuthScope = (value: unknown): value is OAuthScope => (OAUTH_SCOPES as readonly unknown[]).includes(value);

/** The reading scopes: what *Read only* gives, and what a client asks for when it knows nothing more (the protected resource's list). */
export const READ_SCOPES: readonly OAuthScope[] = [STORES_READ, ...AREAS.map((area) => `${area}:read` as const)];

/** The most characters a `scope` parameter may have. */
const SCOPE_MAX = 2000;

/** The scopes in a space-separated `scope` parameter: the known ones, and the unknown ones (ignored, as RFC 6749 3.3 allows). */
export function parseScopeParam(raw: string | null | undefined): { scopes: OAuthScope[]; unknown: string[] } {
  const words = (raw ?? "").slice(0, SCOPE_MAX).split(/\s+/).filter(Boolean);
  return { scopes: normaliseScopes(words.filter(isOAuthScope), { storesRead: false }), unknown: [...new Set(words.filter((w) => !isOAuthScope(w)))] };
}

/** Scopes in their canonical order, each `write` with its `read`, nothing unknown; `stores:read` always, unless told not to add it. */
export function normaliseScopes(keys: readonly string[], { storesRead = true }: { storesRead?: boolean } = {}): OAuthScope[] {
  const wanted = new Set<string>(storesRead ? [STORES_READ] : []);
  for (const key of keys) {
    if (!isOAuthScope(key)) continue;
    wanted.add(key);
    if (key.endsWith(":write")) wanted.add(key.replace(/:write$/, ":read"));
  }
  return OAUTH_SCOPES.filter((scope) => wanted.has(scope));
}

/** The permission keys among scopes (`stores:read` is no key): the cap a grant puts on a person's role (`PermissionHolder.limit`). */
export const scopeKeys = (scopes: readonly string[]): PermissionKey[] => normaliseScopes(scopes, { storesRead: false }).filter((s): s is PermissionKey => s !== STORES_READ);

/**
 * The person's one choice on the consent screen (Homer's view): *Read only*; *Read and propose changes*, the default, where every change
 * waits for their yes in the admin; or *Read and change*, within their own permissions, where gated changes still wait.
 */
export const ACCESS_LEVELS = ["read", "propose", "change"] as const;
export type AccessLevel = (typeof ACCESS_LEVELS)[number];
export const DEFAULT_LEVEL: AccessLevel = "propose";
export const isAccessLevel = (value: unknown): value is AccessLevel => (ACCESS_LEVELS as readonly unknown[]).includes(value);

/** The scopes a level gives a person who holds `held` (their keys in the stores they connect, together): never more than they hold. */
export function levelScopes(level: AccessLevel, held: readonly PermissionKey[]): OAuthScope[] {
  return normaliseScopes(level === "read" ? held.filter((key) => key.endsWith(":read")) : held);
}

/**
 * What a grant holds: the level's scopes, narrowed to the ones ticked in *Choose permissions* (Lisa's step) when it was opened. A ticked scope
 * outside the level or outside what the person holds is never added; `stores:read` always is.
 */
export function grantScopes(level: AccessLevel, held: readonly PermissionKey[], chosen?: readonly string[] | null): OAuthScope[] {
  const allowed = levelScopes(level, held);
  if (!chosen) return allowed;
  const picked = new Set(normaliseScopes(chosen));
  return allowed.filter((scope) => picked.has(scope));
}

/** Whether a grant's scopes hold a scope: the scope itself, or the `write` of a `read` scope. */
export function scopeHeld(scopes: readonly string[], scope: OAuthScope): boolean {
  return scopes.includes(scope) || (scope.endsWith(":read") && scopes.includes(scope.replace(/:read$/, ":write")));
}

/** The scopes a call needs that a grant does not hold: an empty list when it may make the call. */
export const missingScopes = (granted: readonly string[], needed: readonly OAuthScope[]): OAuthScope[] => needed.filter((scope) => !scopeHeld(granted, scope));

// ---------------------------------------------------------------------------------------------------------------------------------
// Resources and the issuer (B1, B4)
// ---------------------------------------------------------------------------------------------------------------------------------

/**
 * The protected resources tokens are issued for, each by its path on the site: the owner MCP now; the Admin API joins when apps come
 * (unit D), as one more entry. A token is bound to one (its audience) and refused at any other.
 */
export const OAUTH_RESOURCES = { mcp: "/api/mcp" } as const;
export type OAuthResource = keyof typeof OAUTH_RESOURCES;

/** A resource's canonical address (RFC 8707, RFC 9728): the site's origin and the resource's path, no trailing slash. */
export const resourceUrl = (site: string, resource: OAuthResource): string => `${site.replace(/\/+$/, "")}${OAUTH_RESOURCES[resource]}`;

/** The resource a `resource` parameter names, or null: its canonical address exactly, or with one trailing slash. Nothing else. */
export function resourceOf(raw: string | null | undefined, site: string): OAuthResource | null {
  if (!raw) return null;
  for (const resource of Object.keys(OAUTH_RESOURCES) as OAuthResource[]) {
    const canonical = resourceUrl(site, resource);
    if (raw === canonical || raw === `${canonical}/`) return resource;
  }
  return null;
}

/** Where the protected resource's metadata is (RFC 9728 3.1): the well-known address with the resource's path after it. */
export const resourceMetadataUrl = (site: string, resource: OAuthResource = "mcp"): string =>
  `${site.replace(/\/+$/, "")}/.well-known/oauth-protected-resource${OAUTH_RESOURCES[resource]}`;

/** Paths of the authorization server, after the issuer. */
export const OAUTH_PATHS = {
  authorize: "/oauth/authorize",
  token: "/api/oauth/token",
  revoke: "/api/oauth/revoke",
  register: "/api/oauth/register",
} as const;

/** The docs page that tells how to connect an AI assistant (unit E writes it). */
export const MCP_DOCS_PATH = "/docs/developers/mcp";

/** The authorization server's metadata (RFC 8414), its issuer the site's origin. */
export function authorizationServerMetadata(issuer: string) {
  const at = (path: string) => `${issuer}${path}`;
  return {
    issuer,
    authorization_endpoint: at(OAUTH_PATHS.authorize),
    token_endpoint: at(OAUTH_PATHS.token),
    revocation_endpoint: at(OAUTH_PATHS.revoke),
    registration_endpoint: at(OAUTH_PATHS.register),
    client_id_metadata_document_supported: true,
    code_challenge_methods_supported: ["S256"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    response_types_supported: ["code"],
    response_modes_supported: ["query"],
    token_endpoint_auth_methods_supported: ["none", "client_secret_basic"],
    revocation_endpoint_auth_methods_supported: ["none", "client_secret_basic"],
    scopes_supported: [...OAUTH_SCOPES],
    authorization_response_iss_parameter_supported: true,
    service_documentation: at(MCP_DOCS_PATH),
  };
}

/**
 * The owner MCP's protected resource metadata (RFC 9728): our issuer first, then Supabase's while Kaizen Life's tokens come from it, the
 * reading scopes a client asks for when it knows nothing more, and the docs page.
 */
export function protectedResourceMetadata(site: string, supabaseIssuer: string | null) {
  return {
    resource: resourceUrl(site, "mcp"),
    authorization_servers: [site, ...(supabaseIssuer ? [supabaseIssuer] : [])],
    scopes_supported: [...READ_SCOPES],
    bearer_methods_supported: ["header"],
    resource_name: "Kaizena Flow",
    resource_documentation: `${site}${MCP_DOCS_PATH}`,
  };
}

/** A quoted value of a `WWW-Authenticate` parameter: no quote or backslash can close it early. */
const quoted = (value: string) => `"${value.replace(/["\\\r\n]/g, "")}"`;

/** The answer to a call whose tool needs a scope the token does not hold (RFC 6750 3.1): every scope the call needs, in one challenge. */
export function insufficientScopeChallenge(needed: readonly string[], resourceMetadata: string): string {
  return `Bearer error="insufficient_scope", scope=${quoted([...new Set(needed)].join(" "))}, resource_metadata=${quoted(resourceMetadata)}, error_description=${quoted("The token's grant does not include what this call needs.")}`;
}

/** The answer to a call without a usable token: where to learn how to get one, and why this one was refused if one was sent. */
export function bearerChallenge(resourceMetadata: string, invalid: boolean): string {
  return `Bearer resource_metadata=${quoted(resourceMetadata)}${invalid ? `, error="invalid_token"` : ""}`;
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Redirect URIs (B2, RFC 8252)
// ---------------------------------------------------------------------------------------------------------------------------------

/** The longest redirect URI or client id taken. */
export const URI_MAX = 2000;

/** Loopback hosts a native client listens on: the two literal addresses and, as many clients use it, `localhost`. */
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "[::1]", "localhost"]);

/** What kind of client registered (RFC 7591 with OpenID's `application_type`): web clients redirect over HTTPS, native ones also to a loopback. */
export type ApplicationType = "web" | "native";

/** Whether an address is a loopback redirect: plain `http` to this machine (RFC 8252 7.3). */
export function isLoopbackRedirect(url: URL): boolean {
  return url.protocol === "http:" && LOOPBACK_HOSTS.has(url.hostname);
}

/**
 * Why a redirect URI cannot be registered, or null: an absolute HTTPS address, or a loopback `http` one for a native client (any client when
 * the kind is not said); never a fragment, a user name or another scheme. Custom schemes (`app://`) are not taken.
 */
export function redirectUriProblem(raw: unknown, applicationType?: ApplicationType): string | null {
  if (typeof raw !== "string" || raw.length === 0) return "A redirect URI is empty.";
  if (raw.length > URI_MAX) return "A redirect URI is too long.";
  if (raw.includes("#")) return "A redirect URI may not have a fragment.";
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return "A redirect URI is not an absolute address.";
  }
  if (url.username || url.password) return "A redirect URI may not hold a user name or password.";
  if (isLoopbackRedirect(url)) return applicationType === "web" ? "A web client's redirect URIs use HTTPS." : null;
  if (url.protocol !== "https:") return "A redirect URI uses HTTPS, or plain HTTP to a loopback address.";
  if (applicationType === "native" || applicationType === undefined) return null;
  return LOOPBACK_HOSTS.has(url.hostname) ? "A web client's redirect URIs are not on this machine." : null;
}

/**
 * Whether the redirect URI an authorization request names is one the client registered: the same string exactly, except that a loopback
 * address's port may differ (RFC 8252 7.3), as a native client picks a free port each time. Scheme, host, path and query must agree.
 */
export function redirectMatches(registered: readonly string[], asked: string): boolean {
  if (registered.includes(asked)) return true;
  let url: URL;
  try {
    url = new URL(asked);
  } catch {
    return false;
  }
  if (!isLoopbackRedirect(url) || asked.includes("#") || url.username || url.password) return false;
  return registered.some((entry) => {
    try {
      const known = new URL(entry);
      return isLoopbackRedirect(known) && known.hostname === url.hostname && known.pathname === url.pathname && known.search === url.search;
    } catch {
      return false;
    }
  });
}

/** The address an authorization answer goes to: the redirect URI with the answer's parameters added to its own query (RFC 6749 4.1.2). */
export function redirectWith(redirectUri: string, params: Record<string, string | null | undefined>): string {
  const url = new URL(redirectUri);
  for (const [key, value] of Object.entries(params)) if (value != null) url.searchParams.set(key, value);
  return url.toString();
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Client ID Metadata Documents (B2)
// ---------------------------------------------------------------------------------------------------------------------------------

/** The most a metadata document may weigh, and how long its fetch may take. */
export const METADATA_MAX_BYTES = 64 * 1024;
export const METADATA_TIMEOUT_MS = 5000;
/** A document is kept for what its cache headers allow, between these. */
export const METADATA_MIN_SECONDS = 60;
export const METADATA_MAX_SECONDS = 24 * 60 * 60;
/** The most redirect URIs a client may have. */
export const REDIRECT_URIS_MAX = 20;

/**
 * Why a client id cannot be a metadata document's address, or null: an HTTPS address on the usual port, written as its address is, with a
 * path and no fragment, user name, dot segments or loopback host. Anything else is looked up as a registered client's id.
 */
export function metadataUrlProblem(raw: string): string | null {
  if (raw.length > URI_MAX) return "The client id is too long.";
  if (!raw.startsWith("https://")) return "A client id that is an address uses HTTPS.";
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return "The client id is not an address.";
  }
  if (url.href !== raw) return "The client id is not written as its address is.";
  if (url.username || url.password || url.hash || url.port) return "The client id may not hold a user name, a fragment or a port.";
  if (url.pathname === "/" || url.pathname === "") return "The client id's address needs a path.";
  if (url.pathname.split("/").some((segment) => segment === "." || segment === "..")) return "The client id's path may not hold dot segments.";
  if (LOOPBACK_HOSTS.has(url.hostname) || !url.hostname.includes(".")) return "The client id is not on a public host.";
  return null;
}

/** Whether a client id is a metadata document's address (`metadataUrlProblem()` finds nothing). */
export const isMetadataClientId = (raw: string): boolean => metadataUrlProblem(raw) === null;

export type ClientMetadata = { name: string; redirectUris: string[]; logoUri: string | null; clientUri: string | null };

/** What an outside assistant's change says when the connection that asked for it ended before the yes (D439 review). */
export const GRANT_ENDED_NOTE = "The connection that asked for it was ended, so it can no longer be approved.";

/** The longest client name kept and shown. */
export const CLIENT_NAME_MAX = 60;

/** What a name stands for when nothing of it is left. */
export const UNNAMED_CLIENT = "An unnamed app";

/**
 * A client's name as Kaizena Flow keeps it and shows it everywhere (D439): on the consent screen, the screens that list connections, an
 * approval's words, a notice, a tool's refusal and the AI manager's prompt. The client chose it, so it is data: compatibility forms folded
 * (NFKC), every control and format character gone (direction marks and isolates, zero-width and invisible characters such as U+2060 to
 * U+2064, U+FEFF and U+061C, a soft hyphen), only letters, marks, digits, spaces and a little punctuation kept (no quote, colon, angle
 * bracket or newline that could pass for something else), one space between words, at most 60 characters.
 */
export function safeClientName(value: string): string {
  const name = value
    .normalize("NFKC")
    // Invisible characters go first, wherever they are (JavaScript counts U+FEFF as a space): they join letters, never words.
    .replace(/[­؜᠎​-‏‪-‮⁠-⁤⁦-⁩﻿]/g, "")
    .replace(/\s+/g, " ")
    .replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, "")
    .replace(/[^\p{L}\p{M}\p{N} .,&()'+_-]/gu, "")
    .replace(/ +/g, " ")
    .trim()
    .slice(0, CLIENT_NAME_MAX)
    .trim();
  return name || UNNAMED_CLIENT;
}

/** Letters that look like the Latin ones of a platform word, folded to them before the name is checked. */
const LOOKALIKES: Record<string, string> = {
  "а": "a", "е": "e", "і": "i", "ı": "i", "к": "k", "о": "o", "α": "a", "ε": "e", "ι": "i", "κ": "k", "ο": "o", "ᴢ": "z", "ʐ": "z", "ո": "n", "η": "n",
  "0": "o", "1": "i", "3": "e", "4": "a", "!": "i", "|": "i", "l": "i",
};

/** Words a client may not use in its name: it could pass for Kaizena Flow itself, or for a mark Kaizena Flow gives. */
const PLATFORM_WORDS = ["kaizen", "verified", "official"];

/**
 * Why a client's name cannot be kept, or null (D439): one that names Kaizena Flow ("Kaizen", "Kaizena Flow", however spelled or spaced,
 * lookalike letters folded) or claims a mark only Kaizena Flow gives ("Verified", "Official"). Checked when a client registers and when its
 * metadata document is read; clients Kaizena Flow makes itself are not read here.
 */
export function clientNameProblem(raw: string): string | null {
  const folded = [...raw.normalize("NFKC").toLowerCase()]
    .map((ch) => LOOKALIKES[ch] ?? ch)
    .join("")
    .normalize("NFD")
    .replace(/[^a-z]/g, "");
  const word = PLATFORM_WORDS.find((w) => folded.includes(w.replace(/l/g, "i")));
  return word ? `A client's name may not say "${word}": it could pass for Kaizena Flow or a mark Kaizena Flow gives.` : null;
}

/** An optional HTTPS address of a document (`logo_uri`, `client_uri`), or null. */
function httpsOrNull(value: unknown): string | null {
  if (typeof value !== "string" || value.length > URI_MAX) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password ? url.toString() : null;
  } catch {
    return null;
  }
}

/**
 * A metadata document checked against the address it was fetched from: `client_id` equal to that address exactly, a `client_name`, and
 * `redirect_uris` each HTTPS or a loopback address. A document that names a client secret or a way to authenticate other than none is
 * refused: such a client is not public, and a document cannot hold a secret.
 */
export function readClientMetadata(document: unknown, url: string): { ok: true; client: ClientMetadata } | { ok: false; problem: string } {
  if (typeof document !== "object" || document === null || Array.isArray(document)) return { ok: false, problem: "The document is not a JSON object." };
  const doc = document as Record<string, unknown>;
  if (doc.client_id !== url) return { ok: false, problem: "The document's client_id is not the address it was fetched from." };
  if (typeof doc.client_name !== "string" || safeClientName(doc.client_name) === UNNAMED_CLIENT) return { ok: false, problem: "The document has no client_name." };
  const nameProblem = clientNameProblem(doc.client_name);
  if (nameProblem) return { ok: false, problem: nameProblem };
  const name = safeClientName(doc.client_name);
  if (!Array.isArray(doc.redirect_uris) || doc.redirect_uris.length === 0) return { ok: false, problem: "The document has no redirect_uris." };
  if (doc.redirect_uris.length > REDIRECT_URIS_MAX) return { ok: false, problem: "The document has too many redirect_uris." };
  for (const uri of doc.redirect_uris) {
    const problem = redirectUriProblem(uri);
    if (problem) return { ok: false, problem };
  }
  if ("client_secret" in doc || "client_secret_expires_at" in doc) return { ok: false, problem: "A metadata document may not hold a client secret." };
  if (doc.token_endpoint_auth_method !== undefined && doc.token_endpoint_auth_method !== "none") {
    return { ok: false, problem: "Only public clients (token_endpoint_auth_method none) are taken from a metadata document." };
  }
  if (doc.grant_types !== undefined && !(Array.isArray(doc.grant_types) && doc.grant_types.includes("authorization_code"))) {
    return { ok: false, problem: "The document's grant_types leave out authorization_code." };
  }
  return { ok: true, client: { name, redirectUris: [...new Set(doc.redirect_uris as string[])], logoUri: httpsOrNull(doc.logo_uri), clientUri: httpsOrNull(doc.client_uri) } };
}

/** How long a fetched document is kept: its `Cache-Control` max-age (none for `no-store` or `no-cache`), held between a minute and a day. */
export function metadataLifetime(cacheControl: string | null | undefined): number {
  const header = (cacheControl ?? "").toLowerCase();
  if (/\b(no-store|no-cache)\b/.test(header)) return METADATA_MIN_SECONDS;
  const age = /\bmax-age=(\d+)/.exec(header);
  const seconds = age ? Number(age[1]) : 0;
  return Math.min(METADATA_MAX_SECONDS, Math.max(METADATA_MIN_SECONDS, Number.isFinite(seconds) ? seconds : 0));
}

/** A registered client's metadata (RFC 7591), checked: public, its redirect URIs by its application type, a name. */
export function readRegistration(
  body: unknown,
): { ok: true; client: ClientMetadata & { applicationType: ApplicationType | null } } | { ok: false; error: "invalid_redirect_uri" | "invalid_client_metadata"; problem: string } {
  if (typeof body !== "object" || body === null || Array.isArray(body)) return { ok: false, error: "invalid_client_metadata", problem: "The registration is not a JSON object." };
  const doc = body as Record<string, unknown>;
  const applicationType = doc.application_type === "web" || doc.application_type === "native" ? doc.application_type : null;
  if (doc.application_type !== undefined && !applicationType) return { ok: false, error: "invalid_client_metadata", problem: "application_type is web or native." };
  if (!Array.isArray(doc.redirect_uris) || doc.redirect_uris.length === 0) return { ok: false, error: "invalid_redirect_uri", problem: "redirect_uris is required." };
  if (doc.redirect_uris.length > REDIRECT_URIS_MAX) return { ok: false, error: "invalid_redirect_uri", problem: "Too many redirect_uris." };
  for (const uri of doc.redirect_uris) {
    const problem = redirectUriProblem(uri, applicationType ?? undefined);
    if (problem) return { ok: false, error: "invalid_redirect_uri", problem };
  }
  const method = doc.token_endpoint_auth_method;
  if (method !== undefined && method !== "none") return { ok: false, error: "invalid_client_metadata", problem: "Only public clients register here: token_endpoint_auth_method none." };
  if (doc.grant_types !== undefined && !(Array.isArray(doc.grant_types) && doc.grant_types.includes("authorization_code"))) {
    return { ok: false, error: "invalid_client_metadata", problem: "grant_types must include authorization_code." };
  }
  if (doc.response_types !== undefined && !(Array.isArray(doc.response_types) && doc.response_types.every((t) => t === "code"))) {
    return { ok: false, error: "invalid_client_metadata", problem: "response_types is code." };
  }
  if (typeof doc.client_name === "string") {
    const nameProblem = clientNameProblem(doc.client_name);
    if (nameProblem) return { ok: false, error: "invalid_client_metadata", problem: nameProblem };
  }
  return {
    ok: true,
    client: {
      name: typeof doc.client_name === "string" ? safeClientName(doc.client_name) : UNNAMED_CLIENT,
      redirectUris: [...new Set(doc.redirect_uris as string[])],
      logoUri: httpsOrNull(doc.logo_uri),
      clientUri: httpsOrNull(doc.client_uri),
      applicationType,
    },
  };
}

/**
 * The host a person is shown for a client: its metadata document's (Kaizena Flow fetched it from there), else the redirect URI the code
 * goes to (the request's, or the first registered). Never the `client_uri` a registration states, which anyone may write.
 */
export function clientHost(client: { clientId: string; clientUri?: string | null; redirectUris: readonly string[] }, redirectUri?: string): string {
  for (const candidate of [isMetadataClientId(client.clientId) ? client.clientId : null, redirectUri ?? null, client.redirectUris[0]]) {
    if (!candidate) continue;
    try {
      return new URL(candidate).host;
    } catch {
      // the next one
    }
  }
  return "";
}

// ---------------------------------------------------------------------------------------------------------------------------------
// The authorization request (B4)
// ---------------------------------------------------------------------------------------------------------------------------------

/** A PKCE challenge as S256 makes it: 43 characters of base64url. A code verifier is 43 to 128 unreserved characters (RFC 7636 4.1). */
export const isCodeChallenge = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z0-9_-]{43}$/.test(value);
export const isCodeVerifier = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z0-9._~-]{43,128}$/.test(value);

/** The most characters of `state` kept and sent back. */
export const STATE_MAX = 1000;

export type AuthorizeRequest = {
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  state: string;
  resource: OAuthResource;
  scopes: OAuthScope[];
};

/** Why an authorization request is refused: shown on the page (`show`), or sent back to the client's redirect URI (`redirect`). */
export type AuthorizeRefusal =
  | { show: "client" | "redirect_uri" | "repeated" }
  | { redirect: "invalid_request" | "unsupported_response_type" | "invalid_scope" | "invalid_target"; description: string };

type Query = Record<string, string | string[] | undefined>;

/** One parameter's value, or null when absent; `repeated` when sent more than once (RFC 6749 3.1 refuses it). */
function one(query: Query, key: string): string | null | "repeated" {
  const value = query[key];
  if (Array.isArray(value)) return value.length === 1 ? value[0] : "repeated";
  return value ?? null;
}

/**
 * The parameters every authorization request carries before its client is looked up: the client and its redirect URI, which say where a
 * refusal may be sent. Without them nothing may be sent anywhere: the page says what is wrong.
 */
export function readClientParams(query: Query): { ok: true; clientId: string; redirectUri: string } | { ok: false; refusal: AuthorizeRefusal } {
  const clientId = one(query, "client_id");
  const redirectUri = one(query, "redirect_uri");
  if (clientId === "repeated" || redirectUri === "repeated") return { ok: false, refusal: { show: "repeated" } };
  if (!clientId || clientId.length > URI_MAX) return { ok: false, refusal: { show: "client" } };
  if (!redirectUri || redirectUri.length > URI_MAX) return { ok: false, refusal: { show: "redirect_uri" } };
  return { ok: true, clientId, redirectUri };
}

/**
 * The rest of an authorization request, read once its redirect URI is known to be the client's: `response_type=code`, a PKCE challenge
 * with S256 (no other method, and never none), a `state`, and `resource` the canonical address of a resource of ours (RFC 8707). Unknown
 * scopes are left out, as RFC 6749 3.3 lets the server do: the person chooses what to give on the consent screen.
 */
export function readAuthorizeRequest(query: Query, site: string, client: { clientId: string; redirectUri: string }): { ok: true; request: AuthorizeRequest } | { ok: false; refusal: AuthorizeRefusal } {
  const keys = ["response_type", "code_challenge", "code_challenge_method", "state", "resource", "scope"] as const;
  const values: Record<(typeof keys)[number], string | null> = { response_type: null, code_challenge: null, code_challenge_method: null, state: null, resource: null, scope: null };
  for (const key of keys) {
    const value = one(query, key);
    if (value === "repeated") return { ok: false, refusal: { redirect: "invalid_request", description: `${key} was sent more than once.` } };
    values[key] = value;
  }
  if (values.response_type !== "code") return { ok: false, refusal: { redirect: "unsupported_response_type", description: "Only response_type=code is supported." } };
  if (values.code_challenge_method !== "S256") return { ok: false, refusal: { redirect: "invalid_request", description: "PKCE with code_challenge_method=S256 is required." } };
  if (!isCodeChallenge(values.code_challenge)) return { ok: false, refusal: { redirect: "invalid_request", description: "A code_challenge (S256, base64url) is required." } };
  if (!values.state || values.state.length > STATE_MAX) return { ok: false, refusal: { redirect: "invalid_request", description: "A state of at most 1000 characters is required." } };
  const resource = resourceOf(values.resource, site);
  if (!resource) return { ok: false, refusal: { redirect: "invalid_target", description: `resource must be ${resourceUrl(site, "mcp")}.` } };
  return {
    ok: true,
    request: { clientId: client.clientId, redirectUri: client.redirectUri, codeChallenge: values.code_challenge, state: values.state, resource, scopes: parseScopeParam(values.scope).scopes },
  };
}
