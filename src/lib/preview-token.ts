import { createHash, randomBytes } from "node:crypto";

/**
 * A preview link's token (wave 7 unit F, D340; the rest of the rules are `preview-links.ts`, which the browser may import): made here,
 * shown to the person once, and kept by the database only as its SHA-256. Server only (it needs `node:crypto`).
 */

const TOKEN = /^pv_[A-Za-z0-9_-]{43}$/;

/** A new token: `pv_` and 32 random bytes in base64url. */
export const newPreviewToken = (): string => `pv_${randomBytes(32).toString("base64url")}`;

/** Whether something has a token's shape (anything else is never looked up). */
export const isPreviewToken = (value: unknown): value is string => typeof value === "string" && TOKEN.test(value);

/** What the database keeps of a token. */
export const previewTokenHash = (token: string): string => createHash("sha256").update(token).digest("hex");
