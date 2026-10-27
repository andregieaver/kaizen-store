import type { BlogCommentSetting } from "./blogs";

/**
 * Visitors' comments on articles (wave 7 unit G, D341, decision 3 of `docs/wave-7-storefront.md`): the checks of what a visitor wrote and
 * the spam check, in code, without a service outside the EU. Pure and free of zod, so the comment form in the visitor's browser reads the
 * same limits. What a comment becomes is only `commentOutcome()`: with comments off nothing is taken, a robot's (the hidden field filled)
 * is answered as if taken and dropped, one the check flags is kept as `spam` (staff can still approve it), and the rest wait for staff
 * (`moderated`, the default) or are shown at once (`automatic`).
 */

export const COMMENT_NAME_MAX = 80;
export const COMMENT_EMAIL_MAX = 254;
export const COMMENT_BODY_MAX = 2000;
/** People take a few seconds to write a comment; a form sent sooner than this after it was shown is a robot's. */
export const COMMENT_MIN_SECONDS = 3;
/** More web addresses than this in a comment is the mark of an advertisement. */
export const COMMENT_LINKS_MAX = 1;
/** Comments one visitor may send to a store in an hour, and a store may take in an hour from everyone. */
export const COMMENTS_PER_VISITOR_HOUR = 5;
export const COMMENTS_PER_STORE_HOUR = 200;
/** Days a rejected or spam comment is kept before `runRetention()` deletes it (the `blog_comments` retention rule, a test holds them equal). */
export const REFUSED_COMMENT_DAYS = 30;
/** How far back the same text counts as repeated. */
export const REPEAT_HOURS = 24;

export const COMMENT_STATUSES = ["pending", "approved", "rejected", "spam"] as const;
export type CommentStatus = (typeof COMMENT_STATUSES)[number];

export const SPAM_REASONS = ["honeypot", "too_fast", "links", "link_in_name", "repeated"] as const;
export type SpamReason = (typeof SPAM_REASONS)[number];

/** What a visitor sent, as the form sends it. */
export type CommentDraft = { name: string; email: string; body: string };

export type CommentFieldProblem = "missing" | "too_long" | "invalid";
export type CommentProblems = Partial<Record<keyof CommentDraft, CommentFieldProblem>>;

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ADDRESS = /\b(?:https?:\/\/|www\.)[^\s]+|\b[a-z0-9-]+\.(?:com|net|org|info|biz|ru|cn|xyz|top|io|co|shop|online|site)\b/gi;

/** The comment as it will be kept: trimmed, the body's lines kept, runs of blank lines folded, no control characters. */
export function cleanComment(draft: CommentDraft): CommentDraft {
  const plain = (text: string) =>
    text.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "");
  return {
    name: plain(draft.name).replace(/\s+/g, " ").trim(),
    email: plain(draft.email).trim(),
    body: plain(draft.body).replace(/\r\n?/g, "\n").replace(/\n{3,}/g, "\n\n").trim(),
  };
}

/** What is wrong with a comment as typed (cleaned first): every field's problem, or none. */
export function commentProblems(draft: CommentDraft): CommentProblems {
  const c = cleanComment(draft);
  const problems: CommentProblems = {};
  if (!c.name) problems.name = "missing";
  else if (c.name.length > COMMENT_NAME_MAX) problems.name = "too_long";
  if (c.email) {
    if (c.email.length > COMMENT_EMAIL_MAX) problems.email = "too_long";
    else if (!EMAIL.test(c.email)) problems.email = "invalid";
  }
  if (!c.body) problems.body = "missing";
  else if (c.body.length > COMMENT_BODY_MAX) problems.body = "too_long";
  return problems;
}

/** How many web addresses a text holds. */
export const linkCount = (text: string): number => text.match(ADDRESS)?.length ?? 0;

/** A comment's text made comparable: lower case, letters and digits only, so the same text sent again is found however it is spaced. */
export const normalisedBody = (body: string): string => body.toLowerCase().normalize("NFKC").replace(/[^\p{L}\p{N}]+/gu, " ").trim();

/**
 * What the spam check finds in a comment: the hidden field filled (`honeypot`), sent too fast after the form was shown (`too_fast`),
 * more addresses than one (`links`), an address as the name (`link_in_name`), the same text posted in the store lately (`repeated`, which
 * the server knows). Empty when it looks like a person's.
 */
export function spamReasons(input: { name: string; body: string; website: string; elapsedMs: number; repeated: boolean }): SpamReason[] {
  const reasons: SpamReason[] = [];
  if (input.website.trim()) reasons.push("honeypot");
  if (input.elapsedMs < COMMENT_MIN_SECONDS * 1000) reasons.push("too_fast");
  if (linkCount(input.body) > COMMENT_LINKS_MAX) reasons.push("links");
  if (linkCount(input.name) > 0) reasons.push("link_in_name");
  if (input.repeated) reasons.push("repeated");
  return reasons;
}

export type CommentOutcome =
  /** Comments are off on this blog: nothing is taken. */
  | { kind: "closed" }
  /** A robot (the hidden field): answered as if taken, nothing kept. */
  | { kind: "dropped" }
  | { kind: "kept"; status: CommentStatus };

/** What a comment becomes on a blog with this setting, from what the spam check found. */
export function commentOutcome(setting: BlogCommentSetting, reasons: readonly SpamReason[]): CommentOutcome {
  if (setting === "off") return { kind: "closed" };
  if (reasons.includes("honeypot")) return { kind: "dropped" };
  if (reasons.length > 0) return { kind: "kept", status: "spam" };
  return { kind: "kept", status: setting === "automatic" ? "approved" : "pending" };
}

/** What staff may do to a comment: show it, refuse it, or mark it as spam (deleting is apart). */
export const MODERATIONS = ["approve", "reject", "spam"] as const;
export type Moderation = (typeof MODERATIONS)[number];
export const statusOf = (action: Moderation): CommentStatus => (action === "approve" ? "approved" : action === "reject" ? "rejected" : "spam");

/** What the visitor is told after sending: shown now, waiting for the store, or (a robot, or spam) told it waits too, never why. */
export type CommentAnswer = { ok: true; shown: boolean } | { ok: false; error: "closed" | "busy" | "invalid" | "failed"; problems?: CommentProblems };
