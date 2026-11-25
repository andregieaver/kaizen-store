import { createHash, createHmac, createPublicKey, randomBytes, timingSafeEqual, verify } from "node:crypto";

import { z } from "zod";

/**
 * Canva (D898, `docs/design-tools.md` C1), pure: Canva's fixed addresses, the consent link, the signed state a person's browser carries
 * to Canva and back (with the PKCE verifier), Canva's answers read with zod, the check of the JWT Canva signs when its *Return* button
 * brings a person back, and the sizes and names Canva accepts. The server is `src/server/canva.ts`. Server code only (it signs and
 * verifies with `node:crypto`).
 */

/** Canva's REST API (formerly the Connect API) and its OAuth server. Fixed in code: never from a person, a token or a page. */
export const CANVA_AUTHORIZE = "https://www.canva.com/api/oauth/authorize";
export const CANVA_API = "https://api.canva.com/rest";
export const CANVA_TOKEN = `${CANVA_API}/v1/oauth/token`;
export const CANVA_REVOKE = `${CANVA_API}/v1/oauth/revoke`;
/** The public keys Canva signs the return JWT with (Ed25519). */
export const CANVA_KEYS = `${CANVA_API}/v1/connect/keys`;

/** What C1 asks for and nothing more: pictures up, designs made and read, exports, and the person's name. A write scope holds no read. */
export const CANVA_SCOPES = ["asset:read", "asset:write", "design:meta:read", "design:content:read", "design:content:write", "profile:read"] as const;

export const CANVA_CALLBACK = "/api/integrations/canva/callback";
/** The forms that start and end a person's connection (plain posts, so they work before any script and add no server action). */
export const CANVA_CONNECT = "/api/integrations/canva/connect";
export const CANVA_DISCONNECT = "/api/integrations/canva/disconnect";
export const CANVA_THUMBNAIL = "/api/integrations/canva/thumbnail";
/** The state cookie: only sent to the integration's own paths, for a quarter of an hour. */
export const CANVA_STATE_COOKIE = "kaizen_canva";
export const CANVA_STATE_PATH = "/api/integrations/canva";
export const CANVA_STATE_MINUTES = 15;
/** Where a connect started without a page of its own comes back to. */
export const CANVA_HOME = "/admin/account/connected";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NONCE = /^[A-Za-z0-9_-]{32,128}$/;
/** RFC 7636: 43 to 128 characters of `[A-Za-z0-9-._~]`. */
const VERIFIER = /^[A-Za-z0-9._~-]{43,128}$/;
/** An admin page of ours, as a path: `/admin`, then segments of plain characters. Never a host, a scheme, `//` or `..`. */
const BACK = /^\/admin(\/[A-Za-z0-9_~-][A-Za-z0-9._~-]{0,80}){0,6}$/;
/** Canva's ids (designs, users, teams): letters, digits, `_` and `-`. */
export const CANVA_ID = /^[A-Za-z0-9_-]{1,100}$/;
/** The correlation we hand Canva (at most 50 characters, URL safe): 32 characters of base64url. */
const CORRELATION = /^[A-Za-z0-9_-]{32}$/;

/** A fresh nonce or PKCE verifier: 64 characters of base64url, inside both rules. */
export const randomToken = (): string => randomBytes(48).toString("base64url");
/** The PKCE challenge of a verifier: `base64url(sha256(verifier))`, without padding. */
export const codeChallenge = (verifier: string): string => createHash("sha256").update(verifier).digest("base64url");

/** Where the person is sent to allow Kaizena Flow's integration: the scopes C1 needs, a PKCE challenge (S256) and the state. */
export function canvaAuthorizeUrl(input: { clientId: string; redirectUri: string; state: string; challenge: string }): string {
  const params = new URLSearchParams({
    code_challenge: input.challenge,
    code_challenge_method: "S256",
    scope: CANVA_SCOPES.join(" "),
    response_type: "code",
    client_id: input.clientId,
    state: input.state,
    redirect_uri: input.redirectUri,
  });
  return `${CANVA_AUTHORIZE}?${params}`;
}

/** An admin page to come back to, as given, or `CANVA_HOME` when it is anything else. */
export function safeBack(path: unknown): string {
  return typeof path === "string" && BACK.test(path) ? path : CANVA_HOME;
}

// ---------------------------------------------------------------------------------------------------------------------
// The signed state
// ---------------------------------------------------------------------------------------------------------------------

/** What the state cookie holds, signed: the nonce Canva hands back, who pressed Connect, where to go back to, and the PKCE verifier. */
export type CanvaState = { state: string; account: string; back: string; verifier: string; expires: number };

const derive = (secret: Buffer, label: string) => createHmac("sha256", secret).update(label).digest();
const sign = (secret: Buffer, label: string, body: string) => createHmac("sha256", derive(secret, label)).update(body).digest("base64url");
/** Whether `given` is this server's signature of `body` under `label`, compared in constant time. */
function signedHere(secret: Buffer, label: string, body: string, given: string): boolean {
  const want = Buffer.from(sign(secret, label, body));
  const got = Buffer.from(given);
  return want.length === got.length && timingSafeEqual(want, got);
}

export function sealCanvaState(secret: Buffer, value: Omit<CanvaState, "expires">, now = Date.now()): string {
  const body = Buffer.from(JSON.stringify({ ...value, expires: now + CANVA_STATE_MINUTES * 60_000 })).toString("base64url");
  return `${body}.${sign(secret, "kaizen:canva-connect", body)}`;
}

/** The state cookie's contents, or null when it is not one this server signed, is altered, malformed or over. */
export function openCanvaState(secret: Buffer, sealed: string | null | undefined, now = Date.now()): CanvaState | null {
  if (typeof sealed !== "string" || sealed.length > 2000) return null;
  const [body, given, ...rest] = sealed.split(".");
  if (!body || !given || rest.length > 0 || !signedHere(secret, "kaizen:canva-connect", body, given)) return null;
  let value: Partial<CanvaState>;
  try {
    value = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as Partial<CanvaState>;
  } catch {
    return null;
  }
  const { state, account, back, verifier, expires } = value;
  if (typeof state !== "string" || !NONCE.test(state)) return null;
  if (typeof account !== "string" || !UUID.test(account)) return null;
  if (typeof back !== "string" || !BACK.test(back)) return null;
  if (typeof verifier !== "string" || !VERIFIER.test(verifier)) return null;
  if (typeof expires !== "number" || expires <= now || expires - now > CANVA_STATE_MINUTES * 60_000) return null;
  return { state, account, back, verifier, expires };
}

// ---------------------------------------------------------------------------------------------------------------------
// Canva's answers
// ---------------------------------------------------------------------------------------------------------------------

export const canvaTokens = z.object({
  access_token: z.string().min(1).max(8000),
  refresh_token: z.string().min(1).max(8000).optional(),
  expires_in: z.number().int().positive(),
  scope: z.string().max(1000).optional(),
});

export const canvaMe = z.object({ team_user: z.object({ user_id: z.string().regex(CANVA_ID), team_id: z.string().regex(CANVA_ID).optional() }) });
export const canvaProfile = z.object({ profile: z.object({ display_name: z.string().max(500).optional() }) });

const thumbnail = z.object({ url: z.string(), width: z.number().int().positive(), height: z.number().int().positive() });

export const canvaDesign = z.object({
  id: z.string().regex(CANVA_ID),
  title: z.string().max(500).optional(),
  urls: z.object({ edit_url: z.string().max(4000), view_url: z.string().max(4000) }).optional(),
  thumbnail: thumbnail.nullish(),
  page_count: z.number().int().nonnegative().optional(),
  updated_at: z.number().optional(),
});
export type CanvaDesign = z.infer<typeof canvaDesign>;

export const canvaDesignAnswer = z.object({ design: canvaDesign });
export const canvaDesignList = z.object({ items: z.array(z.unknown()), continuation: z.string().max(2000).optional() });

const jobError = z.object({ code: z.string().max(100), message: z.string().max(1000).optional() }).optional();
const jobStatus = z.enum(["in_progress", "success", "failed"]);

export const canvaAssetJob = z.object({ job: z.object({ id: z.string().max(200), status: jobStatus, error: jobError, asset: z.object({ id: z.string().regex(CANVA_ID) }).optional() }) });
export const canvaExportJob = z.object({ job: z.object({ id: z.string().max(200), status: jobStatus, error: jobError, urls: z.array(z.string().max(4000)).optional() }) });

/** The designs of a list answer that read as designs; anything else is left out rather than shown wrong. */
export function readDesigns(items: readonly unknown[]): CanvaDesign[] {
  return items.flatMap((item) => {
    const read = canvaDesign.safeParse(item);
    return read.success ? [read.data] : [];
  });
}

/** Canva's own words for what went wrong, in either of its two error shapes (`{code, message}` or OAuth's `{error, error_description}`). */
export function canvaSaid(json: unknown): { code: string | null; message: string | null } {
  if (!json || typeof json !== "object") return { code: null, message: null };
  const r = json as Record<string, unknown>;
  const code = typeof r.code === "string" ? r.code : typeof r.error === "string" ? r.error : null;
  const message = typeof r.message === "string" ? r.message : typeof r.error_description === "string" ? r.error_description : null;
  return { code: code?.slice(0, 100) ?? null, message: message?.slice(0, 200) ?? null };
}

// ---------------------------------------------------------------------------------------------------------------------
// Addresses Canva gives
// ---------------------------------------------------------------------------------------------------------------------

/** Canva's hosts for thumbnails and exported files: the only ones a download or the thumbnail proxy reads from. */
const FILE_HOSTS = new Set(["document-export.canva.com", "export-download.canva.com"]);

export function isCanvaFile(address: string): boolean {
  try {
    const url = new URL(address);
    return url.protocol === "https:" && FILE_HOSTS.has(url.hostname) && !url.username && !url.password && url.port === "";
  } catch {
    return false;
  }
}

/**
 * A design's edit link with our one-time correlation, which Canva hands back in the return JWT: only a link on `www.canva.com`, else null.
 * Canva's older form (`correlation_state=` as its own parameter) is used, as the correlation is URL safe.
 */
export function editLink(editUrl: string, correlation: string): string | null {
  if (!CORRELATION.test(correlation)) return null;
  try {
    const url = new URL(editUrl);
    if (url.protocol !== "https:" || url.hostname !== "www.canva.com" || url.username || url.password || url.port !== "") return null;
    url.searchParams.set("correlation_state", correlation);
    return url.toString();
  } catch {
    return null;
  }
}

/** A fresh correlation for an edit, and the SHA-256 it is kept as. */
export function newCorrelation(): { correlation: string; hash: string } {
  const correlation = randomBytes(24).toString("base64url");
  return { correlation, hash: correlationHash(correlation) };
}

export const correlationHash = (correlation: string): string => createHash("sha256").update(correlation).digest("hex");

/** Canva's limits for a custom design: each side 40 to 8,000 pixels, at most 25,000,000 in all. */
export const DESIGN_SIDE_MIN = 40;
export const DESIGN_SIDE_MAX = 8000;
export const DESIGN_AREA_MAX = 25_000_000;

/** A design the size of a picture, within Canva's limits, its shape kept as near as whole pixels allow. */
export function designSize(width: number | null, height: number | null): { width: number; height: number } {
  let w = Number.isFinite(width) && (width ?? 0) > 0 ? (width as number) : 1080;
  let h = Number.isFinite(height) && (height ?? 0) > 0 ? (height as number) : 1080;
  const shrink = Math.min(1, DESIGN_SIDE_MAX / w, DESIGN_SIDE_MAX / h, Math.sqrt(DESIGN_AREA_MAX / (w * h)));
  w *= shrink;
  h *= shrink;
  const grow = Math.max(1, DESIGN_SIDE_MIN / w, DESIGN_SIDE_MIN / h);
  const clamp = (n: number) => Math.min(DESIGN_SIDE_MAX, Math.max(DESIGN_SIDE_MIN, Math.floor(n)));
  return { width: clamp(w * grow), height: clamp(h * grow) };
}

/** An asset's name for Canva: at most 50 characters before it is encoded, without control characters; `picture` when nothing is left. */
export function assetName(fileName: string): string {
  const cleaned = [...fileName.replace(/[\p{Cc}\p{Cf}]/gu, "").trim()].slice(0, 50).join("").trim();
  return cleaned || "picture";
}

/** A design's title for the library: its own, or `Canva design`, as a file name. */
export function importedFileName(title: string | undefined): string {
  const base = (title ?? "").replace(/[\p{Cc}\p{Cf}]/gu, "").replace(/[/\\]/g, "-").trim().slice(0, 120) || "Canva design";
  return `${base}.webp`;
}

/** An edited copy's file name: the original's, marked as from Canva. */
export function editedFileName(original: string): string {
  const stem = original.replace(/\.[A-Za-z0-9]{1,5}$/, "").slice(0, 200) || "picture";
  return `${stem}-canva.webp`;
}

// ---------------------------------------------------------------------------------------------------------------------
// The return JWT
// ---------------------------------------------------------------------------------------------------------------------

export type CanvaKey = { kid: string; x: string };

/** The Ed25519 keys of Canva's key set; anything else is left out. */
export function readCanvaKeys(json: unknown): CanvaKey[] {
  const keys = json && typeof json === "object" ? (json as { keys?: unknown }).keys : null;
  if (!Array.isArray(keys)) return [];
  return keys.flatMap((key) => {
    if (!key || typeof key !== "object") return [];
    const k = key as Record<string, unknown>;
    if (k.kty !== "OKP" || k.crv !== "Ed25519" || typeof k.kid !== "string" || typeof k.x !== "string") return [];
    if (k.kid.length > 200 || !/^[A-Za-z0-9_-]{40,50}$/.test(k.x)) return [];
    return [{ kid: k.kid, x: k.x }];
  });
}

export type CanvaReturn = { designId: string; correlation: string; userId: string; teamId: string | null };
export type ReturnRefusal = "malformed" | "unknown_key" | "signature" | "audience" | "type" | "expired" | "claims";

const decodePart = (part: string): unknown => {
  try {
    return JSON.parse(Buffer.from(part, "base64url").toString("utf8"));
  } catch {
    return null;
  }
};

/**
 * Reads the JWT Canva's *Return* button brings back (`correlation_jwt`): signed with one of Canva's Ed25519 keys (`EdDSA`), for our client
 * id, of type `rti`, not past its time, naming a design and our correlation. `unknown_key` asks the caller to read the keys again once.
 */
export function readCanvaReturn(
  token: string,
  keys: readonly CanvaKey[],
  expect: { clientId: string; now?: number },
): { ok: true; value: CanvaReturn } | { ok: false; refusal: ReturnRefusal } {
  if (typeof token !== "string" || token.length > 8000) return { ok: false, refusal: "malformed" };
  const parts = token.split(".");
  if (parts.length !== 3 || parts.some((part) => !/^[A-Za-z0-9_-]+$/.test(part))) return { ok: false, refusal: "malformed" };
  const [head, body, signature] = parts;
  const header = decodePart(head) as { alg?: unknown; kid?: unknown } | null;
  if (!header || header.alg !== "EdDSA" || typeof header.kid !== "string") return { ok: false, refusal: "malformed" };
  const key = keys.find((k) => k.kid === header.kid);
  if (!key) return { ok: false, refusal: "unknown_key" };
  let good = false;
  try {
    const publicKey = createPublicKey({ key: { kty: "OKP", crv: "Ed25519", x: key.x }, format: "jwk" });
    good = verify(null, Buffer.from(`${head}.${body}`), publicKey, Buffer.from(signature, "base64url"));
  } catch {
    good = false;
  }
  if (!good) return { ok: false, refusal: "signature" };
  const claims = decodePart(body) as Record<string, unknown> | null;
  if (!claims) return { ok: false, refusal: "malformed" };
  const audience = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!audience.includes(expect.clientId)) return { ok: false, refusal: "audience" };
  if (claims.type !== "rti") return { ok: false, refusal: "type" };
  const now = Math.floor((expect.now ?? Date.now()) / 1000);
  if (typeof claims.exp !== "number" || claims.exp < now - 60) return { ok: false, refusal: "expired" };
  const { design_id: designId, correlation_state: correlation, sub, team_id: teamId } = claims;
  if (typeof designId !== "string" || !CANVA_ID.test(designId)) return { ok: false, refusal: "claims" };
  if (typeof correlation !== "string" || !CORRELATION.test(correlation)) return { ok: false, refusal: "claims" };
  if (typeof sub !== "string" || !CANVA_ID.test(sub)) return { ok: false, refusal: "claims" };
  if (teamId !== undefined && (typeof teamId !== "string" || !CANVA_ID.test(teamId))) return { ok: false, refusal: "claims" };
  return { ok: true, value: { designId, correlation, userId: sub, teamId: typeof teamId === "string" ? teamId : null } };
}

// ---------------------------------------------------------------------------------------------------------------------
// Thumbnails through our own address
// ---------------------------------------------------------------------------------------------------------------------

/** How long a signed thumbnail address works: Canva's own thumbnail links last 15 minutes. */
export const THUMBNAIL_MINUTES = 15;

/**
 * Our address for one of Canva's thumbnails (`/api/integrations/canva/thumbnail`): Canva's link, its end and our signature, so the proxy
 * reads only links this server handed out, from Canva's file hosts, for a quarter of an hour. Null for any other link.
 */
export function thumbnailAddress(secret: Buffer, link: string, now = Date.now()): string | null {
  if (!isCanvaFile(link) || link.length > 3000) return null;
  const u = Buffer.from(link).toString("base64url");
  const e = String(Math.floor(now / 1000) + THUMBNAIL_MINUTES * 60);
  const s = sign(secret, "kaizen:canva-thumbnail", `${u}.${e}`);
  return `${CANVA_THUMBNAIL}?${new URLSearchParams({ u, e, s })}`;
}

/** Canva's link from our thumbnail address, or null when it was not signed here, is over or is not one of Canva's file links. */
export function readThumbnailAddress(secret: Buffer, params: URLSearchParams, now = Date.now()): string | null {
  const u = params.get("u") ?? "";
  const e = params.get("e") ?? "";
  const s = params.get("s") ?? "";
  if (!/^[A-Za-z0-9_-]{1,4000}$/.test(u) || !/^[0-9]{1,12}$/.test(e) || !/^[A-Za-z0-9_-]{43}$/.test(s)) return null;
  if (!signedHere(secret, "kaizen:canva-thumbnail", `${u}.${e}`, s)) return null;
  const end = Number(e);
  const seconds = Math.floor(now / 1000);
  if (end < seconds || end - seconds > THUMBNAIL_MINUTES * 60) return null;
  const link = Buffer.from(u, "base64url").toString("utf8");
  return isCanvaFile(link) ? link : null;
}
