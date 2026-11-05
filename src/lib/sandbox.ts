import type { PageType } from "./page-content";

/**
 * The page builder's sandbox (D457, `docs/builder-sandbox.md`): the pure parts. A visitor holds a pass, a cookie naming one sandbox and a
 * secret; the server keeps only the secret's SHA-256 (`src/server/sandbox.ts`). A sandbox lasts 7 days after the last visit and 30 at
 * most after it was made. Step S1 offers pages, the header and the footer.
 */

/** The pass's cookie: HttpOnly, path-limited to the sandbox's routes. */
export const SANDBOX_COOKIE = "kaizen_sandbox";
export const SANDBOX_PATH = "/admin/try";
/** Days after the last visit. */
export const SANDBOX_DAYS = 7;
/** Days after it was made, at most. */
export const SANDBOX_MAX_DAYS = 30;
/** A visit pushes the time on at most once a minute. */
export const SANDBOX_TOUCH_SECONDS = 60;
/** While a request to keep it waits (its link lasts 24 hours), a sandbox lasts at least this long from the request (D457 S2). */
export const KEEP_HOLD_HOURS = 48;

const DAY_MS = 24 * 60 * 60 * 1000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
/** 32 random bytes in base64url: 43 characters. */
const SECRET = /^[A-Za-z0-9_-]{43}$/;
const ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";

export type SandboxPass = { id: string; secret: string };

/** The cookie's value: the sandbox's id and the secret. */
export function formatPass(pass: SandboxPass): string {
  return `${pass.id}.${pass.secret}`;
}

/** A cookie's value read back, or null for anything that is not a pass's shape. */
export function readPass(value: string | null | undefined): SandboxPass | null {
  if (!value || value.length > 100) return null;
  const dot = value.indexOf(".");
  if (dot < 0) return null;
  const id = value.slice(0, dot);
  const secret = value.slice(dot + 1);
  return UUID.test(id) && SECRET.test(secret) ? { id, secret } : null;
}

export const isSandboxId = (value: unknown): value is string => typeof value === "string" && UUID.test(value);

/** A sandbox's address from random bytes: `try-` and eight letters or digits, as `commerce.make_sandbox()` requires. */
export function sandboxSlug(random: Uint8Array): string {
  if (random.length < 8) throw new Error("eight random bytes are needed");
  let tail = "";
  for (let i = 0; i < 8; i++) tail += ALPHABET[random[i] % ALPHABET.length];
  return `try-${tail}`;
}

/** When a sandbox ends after a visit at `now`: 7 days on, never past 30 days after it was made. */
export function nextExpiry(createdAt: Date, now: Date): Date {
  return new Date(Math.min(createdAt.getTime() + SANDBOX_MAX_DAYS * DAY_MS, now.getTime() + SANDBOX_DAYS * DAY_MS));
}

/** Whole days left, at least 0, for the bar's words. */
export function daysLeft(expiresAt: Date, now: Date): number {
  return Math.max(0, Math.ceil((expiresAt.getTime() - now.getTime()) / DAY_MS));
}

/** The kinds of page the sandbox offers in step S1, by the address segment each is edited under (as a store's admin names them). */
export const SANDBOX_KINDS = { pages: "page", headers: "header", footers: "footer" } as const satisfies Record<string, PageType>;
export type SandboxSegment = keyof typeof SANDBOX_KINDS;
export type SandboxKind = (typeof SANDBOX_KINDS)[SandboxSegment];

export const isSandboxSegment = (value: unknown): value is SandboxSegment => typeof value === "string" && Object.hasOwn(SANDBOX_KINDS, value);

/** The segment a kind is edited under. */
export function segmentOf(kind: SandboxKind): SandboxSegment {
  return (Object.keys(SANDBOX_KINDS) as SandboxSegment[]).find((segment) => SANDBOX_KINDS[segment] === kind)!;
}

/** Where the sandbox is (`/admin/try/{id}`), and where one kind's editor is under it. */
export const sandboxHome = (id: string) => `${SANDBOX_PATH}/${id}`;
export const sandboxBase = (id: string, kind: SandboxKind) => `${sandboxHome(id)}/${segmentOf(kind)}`;
