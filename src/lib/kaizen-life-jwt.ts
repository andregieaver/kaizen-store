import { createHash, createPrivateKey, createPublicKey, randomBytes, sign, verify } from "node:crypto";

/**
 * The signed requests between Kaizena Flow and Kaizen Life (docs/life-work-summary.md 3.3): server to server, both ways, each a
 * compact JWT signed with the sender's ES256 private key and checked with its public key. It names who sent it (`iss`) and who
 * may take it (`aud`), the door it is for (`htu`, a path) and the body it came with (`bsh`, the body's SHA-256), lives 60
 * seconds, and carries a `jti` the receiver keeps so it is never taken twice. Nothing in it is secret; it proves who asked.
 */
export const FLOW_ISSUER = "kaizena-flow" as const;
export const LIFE_ISSUER = "kaizen-life" as const;
export type LinkParty = typeof FLOW_ISSUER | typeof LIFE_ISSUER;

/** How long a request is good for, and how far apart the two clocks may be. */
export const REQUEST_SECONDS = 60;
export const CLOCK_SKEW_SECONDS = 30;

type Claims = { iss: LinkParty; aud: LinkParty; htu: string; bsh: string; iat: number; exp: number; jti: string };

const b64url = (input: Buffer | string) => Buffer.from(input).toString("base64url");
const bodyHash = (body: string) => createHash("sha256").update(body, "utf8").digest("base64url");

export function signLinkRequest(input: {
  issuer: LinkParty;
  audience: LinkParty;
  path: string;
  body: string;
  privateKeyPem: string;
  now?: Date;
  jti?: string;
}): string {
  const iat = Math.floor((input.now ?? new Date()).getTime() / 1000);
  const claims: Claims = {
    iss: input.issuer,
    aud: input.audience,
    htu: input.path,
    bsh: bodyHash(input.body),
    iat,
    exp: iat + REQUEST_SECONDS,
    jti: input.jti ?? randomBytes(24).toString("base64url"),
  };
  const head = `${b64url(JSON.stringify({ alg: "ES256", typ: "JWT" }))}.${b64url(JSON.stringify(claims))}`;
  const signature = sign("sha256", Buffer.from(head), { key: createPrivateKey(input.privateKeyPem), dsaEncoding: "ieee-p1363" });
  return `${head}.${b64url(signature)}`;
}

export type LinkRequestCheck =
  | { ok: true; jti: string; expiresAt: Date }
  | { ok: false; reason: "malformed" | "signature" | "party" | "door" | "body" | "expired" | "early" };

/** Checks a request's token against the key, the parties, the door and the body it came with. */
export function checkLinkRequest(
  token: string,
  input: { issuer: LinkParty; audience: LinkParty; path: string; body: string; publicKeyPem: string; now?: Date },
): LinkRequestCheck {
  const parts = token.split(".");
  if (parts.length !== 3 || parts.some((p) => !/^[A-Za-z0-9_-]+$/.test(p))) return { ok: false, reason: "malformed" };
  let header: unknown;
  let claims: Partial<Claims>;
  try {
    header = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8"));
    claims = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")) as Partial<Claims>;
  } catch {
    return { ok: false, reason: "malformed" };
  }
  if (!header || typeof header !== "object" || (header as { alg?: unknown }).alg !== "ES256") return { ok: false, reason: "malformed" };
  let good = false;
  try {
    good = verify(
      "sha256",
      Buffer.from(`${parts[0]}.${parts[1]}`),
      { key: createPublicKey(input.publicKeyPem), dsaEncoding: "ieee-p1363" },
      Buffer.from(parts[2], "base64url"),
    );
  } catch {
    good = false;
  }
  if (!good) return { ok: false, reason: "signature" };
  if (claims.iss !== input.issuer || claims.aud !== input.audience) return { ok: false, reason: "party" };
  if (claims.htu !== input.path) return { ok: false, reason: "door" };
  if (claims.bsh !== bodyHash(input.body)) return { ok: false, reason: "body" };
  const { iat, exp, jti } = claims;
  if (typeof iat !== "number" || typeof exp !== "number" || typeof jti !== "string" || jti.length < 16 || jti.length > 100) {
    return { ok: false, reason: "malformed" };
  }
  const now = Math.floor((input.now ?? new Date()).getTime() / 1000);
  if (exp - iat > REQUEST_SECONDS || exp < now) return { ok: false, reason: "expired" };
  if (iat > now + CLOCK_SKEW_SECONDS) return { ok: false, reason: "early" };
  return { ok: true, jti, expiresAt: new Date(exp * 1000) };
}

/** The token of an `Authorization: Bearer …` header, or null. */
export function bearerOf(header: string | null): string | null {
  const match = /^Bearer\s+(\S+)$/i.exec(header ?? "");
  return match ? match[1] : null;
}

/** An email as both apps compare it: the repo's one rule (`normaliseEmail()`, trimmed and lower case). */
export { normaliseEmail as linkEmail } from "./email-address";
