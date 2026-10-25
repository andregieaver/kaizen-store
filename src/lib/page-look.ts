import { createHmac, timingSafeEqual } from "node:crypto";

import { z } from "zod";

/**
 * Looking at a page (D310, `docs/ai-autopilot.md` 9), pure: the widths a page is looked at, what code measures in it, the fixed list the model
 * judges against, how its answer is read into findings and when a look is fine. The server (`src/server/page-looks.ts`) photographs and asks;
 * nothing here changes a page.
 */

export const LOOK_WIDTHS = {
  phone: { width: 390, height: 844 },
  computer: { width: 1280, height: 800 },
} as const;
export type LookWidth = keyof typeof LOOK_WIDTHS;

/** How far down a page is photographed, in CSS pixels. */
export const LOOK_LENGTH_MAX = 6000;
/** Looks of one page within an hour: the look and at most two rounds after a change. */
export const LOOKS_PER_PAGE = 3;
/** How long a look's findings are kept. */
export const LOOK_KEEP_DAYS = 30;
export const FINDINGS_MAX = 12;
const SAYS_MAX = 200;
const PLACE_MAX = 80;

/** What the model judges, a closed list; anything else it says is dropped. */
export const LOOK_CHECKS = ["cut_off", "overlap", "unreadable", "missing_picture", "no_call_to_action", "empty_space", "broken_layout"] as const;
export type LookCheck = (typeof LOOK_CHECKS)[number];

export const CHECK_WORDS: Record<LookCheck, string> = {
  cut_off: "Something is cut off at the edge of the screen or of its box.",
  overlap: "Words, pictures or buttons lie on top of each other.",
  unreadable: "Words are hard to read on their background (too little contrast, too small, or over a busy picture).",
  missing_picture: "A picture is missing, broken, or an empty frame where one should be.",
  no_call_to_action: "There is no clear next step (a button or link) where a visitor would look for one.",
  empty_space: "A large empty gap that looks like a mistake.",
  broken_layout: "The layout looks broken: things squeezed, stretched, misaligned or out of order.",
};

/** What code measured in the page at one width (`src/lib/page-look-shoot.ts`). */
export type ShotFacts = {
  /** The page is wider than the screen, so it scrolls sideways. */
  sideways: boolean;
  /** Pictures that did not load. */
  brokenPictures: number;
  /** Words the page shows. */
  words: number;
  /** A button or link within the first screen, below the page's own header. */
  actionInFirstScreen: boolean;
};

export type FindingSource = "model" | "code" | "checker" | "claims";
export type Finding = {
  /** A check of `LOOK_CHECKS`, or code's own name for what it found. */
  check: string;
  where: LookWidth | "page";
  /** What it is, in a few words: "the top banner", "the home page". */
  place: string | null;
  severity: "blocking" | "minor";
  says: string;
  by: FindingSource;
};

export type LookFindings = { findings: Finding[]; fine: boolean; judged: boolean; note: string | null };

/** Whether a look found nothing that blocks. */
export const lookFine = (findings: readonly Finding[]): boolean => !findings.some((f) => f.severity === "blocking");

const plain = (text: string, max: number) =>
  text
    .replace(/<[^>]*>/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);

const answerSchema = z.object({
  findings: z
    .array(
      z.object({
        check: z.string(),
        where: z.string().optional(),
        place: z.string().optional(),
        severity: z.string().optional(),
        says: z.string(),
      }),
    )
    .default([]),
});

/**
 * The model's answer read into findings: only checks of the list, `phone` or `computer` (else `page`), blocking or minor (minor unless it
 * says blocking), the words plain and short, at most `FINDINGS_MAX`. Null when the answer cannot be read at all.
 */
export function readLookAnswer(text: string): Finding[] | null {
  const body = text.replace(/^\s*```(?:json)?/i, "").replace(/```\s*$/, "").trim();
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(body.slice(start, end + 1));
  } catch {
    return null;
  }
  const parsed = answerSchema.safeParse(raw);
  if (!parsed.success) return null;
  const out: Finding[] = [];
  for (const f of parsed.data.findings) {
    if (!(LOOK_CHECKS as readonly string[]).includes(f.check)) continue;
    const says = plain(f.says, SAYS_MAX);
    if (!says) continue;
    const where = f.where === "phone" || f.where === "computer" ? f.where : "page";
    out.push({ check: f.check, where, place: f.place ? plain(f.place, PLACE_MAX) || null : null, severity: f.severity === "blocking" ? "blocking" : "minor", says, by: "model" });
    if (out.length >= FINDINGS_MAX) break;
  }
  return out;
}

/** Code's own findings from what it measured at each width, worded by code. */
export function codeFindings(facts: Partial<Record<LookWidth, ShotFacts>>, place: string | null = null): Finding[] {
  const out: Finding[] = [];
  const at = (where: LookWidth, check: string, severity: Finding["severity"], says: string) => out.push({ check, where, place, severity, says, by: "code" });
  for (const where of Object.keys(LOOK_WIDTHS) as LookWidth[]) {
    const f = facts[where];
    if (!f) continue;
    if (f.sideways && where === "phone") at(where, "sideways_scroll", "blocking", "The page is wider than a phone's screen, so it scrolls sideways.");
    if (f.brokenPictures > 0) at(where, "broken_picture", "blocking", f.brokenPictures === 1 ? "A picture did not load." : `${f.brokenPictures} pictures did not load.`);
  }
  const all = Object.values(facts).filter((f): f is ShotFacts => Boolean(f));
  if (all.length > 0 && all.every((f) => f.words === 0)) out.push({ check: "no_words", where: "page", place, severity: "blocking", says: "The page shows no words.", by: "code" });
  if (all.length > 0 && all.every((f) => !f.actionInFirstScreen)) {
    out.push({ check: "no_action_first_screen", where: "page", place, severity: "minor", says: "There is no button or link in the first screen, on a phone or a computer.", by: "code" });
  }
  return out;
}

/** The fixed list, as the model is given it. */
export function checklist(): string {
  return LOOK_CHECKS.map((check) => `- ${check}: ${CHECK_WORDS[check]}`).join("\n");
}

// The address that opens one page's draft for the browser that looks at it -------------------------------------------------------------

export const LOOK_TOKEN_MINUTES = 10;

const derive = (secret: Buffer) => createHmac("sha256", secret).update("kaizen:page-look").digest();
const sign = (secret: Buffer, pageId: string, expires: number) => createHmac("sha256", derive(secret)).update(`${pageId}.${expires}`).digest("base64url").slice(0, 32);

/** A token that opens this page's draft, and nothing else, for `LOOK_TOKEN_MINUTES`. */
export function signLook(secret: Buffer, pageId: string, now = Date.now()): string {
  const expires = now + LOOK_TOKEN_MINUTES * 60_000;
  return `${expires}.${sign(secret, pageId, expires)}`;
}

export function lookTokenValid(secret: Buffer, pageId: string, token: string | undefined, now = Date.now()): boolean {
  if (!token) return false;
  const [expiresText, given] = token.split(".");
  const expires = Number(expiresText);
  if (!Number.isFinite(expires) || expires < now || expires > now + LOOK_TOKEN_MINUTES * 60_000 || !given) return false;
  const expected = Buffer.from(sign(secret, pageId, expires));
  const actual = Buffer.from(given);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
