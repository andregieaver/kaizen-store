/**
 * *Was this page helpful?* on the docs (wave 14 unit E1, D442), the pure part: what the route reads and how the sentence is cleaned. No zod
 * and nothing of the server, as the page's feedback part imports the limit. A reader's answer names the page, its language, yes or no, and
 * an optional sentence: never the reader (no address, account, cookie or browser), so `commerce.docs_feedback` holds no person's data
 * beyond what someone types, which the form asks them to leave out.
 */

import { cleanShopperText, type ShopperTextResult } from "./gift";

/** Characters a sentence may have. */
export const DOCS_FEEDBACK_MAX = 500;
/** Lines a sentence may have. */
export const DOCS_FEEDBACK_LINES = 10;
/** How long after a yes or no its sentence may be added. */
export const DOCS_FEEDBACK_COMMENT_MINUTES = 60;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PATH = /^[a-z0-9][a-z0-9-]*(?:\/[a-z0-9][a-z0-9-]*){0,4}$/;

export type DocsFeedbackRequest =
  /** A yes or a no on a page. */
  | { kind: "vote"; path: string; lang: "en" | "nb"; helpful: boolean }
  /** The sentence added to a yes or a no just given, by the id its answer returned. */
  | { kind: "comment"; id: string; comment: string };

/** The request as the route reads it, or null when it is neither shape. */
export function readDocsFeedback(body: unknown): DocsFeedbackRequest | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const value = body as Record<string, unknown>;
  const keys = Object.keys(value).sort().join(",");
  if (keys === "helpful,lang,path") {
    const { path, lang, helpful } = value;
    if (typeof path !== "string" || !PATH.test(path) || (lang !== "en" && lang !== "nb") || typeof helpful !== "boolean") return null;
    return { kind: "vote", path, lang, helpful };
  }
  if (keys === "comment,id") {
    const { id, comment } = value;
    if (typeof id !== "string" || !UUID.test(id) || typeof comment !== "string" || comment.length > DOCS_FEEDBACK_MAX * 4) return null;
    return { kind: "comment", id: id.toLowerCase(), comment };
  }
  return null;
}

/** A sentence as kept: cleaned as a shopper's text is (NFC, no controls or disguising characters), refused when too long. */
export function cleanDocsComment(comment: string): ShopperTextResult {
  return cleanShopperText(comment, { maxChars: DOCS_FEEDBACK_MAX, maxLines: DOCS_FEEDBACK_LINES });
}
