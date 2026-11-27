import { z } from "zod";

import type { ConsentCategory } from "./cookie-consent";
import { CODE_CATEGORIES } from "./custom-code";
import { knownCookie, type KnownCookie } from "./known-cookies";

/**
 * The cookie scan (D58): a real browser opens a site's pages as a first-time
 * visitor would, and records every cookie and storage item it ends up with,
 * the site's own and other services'. It goes round twice: once without a
 * consent choice, where anything optional is a fault, and once with
 * everything allowed, to find what the site's tools set. No database here,
 * so tests can run it against any site.
 */

export const SCANNED_KINDS = ["cookie", "localStorage", "sessionStorage"] as const;
export type ScannedKind = (typeof SCANNED_KINDS)[number];

export const scannedItem = z.object({
  kind: z.enum(SCANNED_KINDS),
  name: z.string().max(200),
  /** The host that set it, without a leading dot. */
  domain: z.string().max(253),
  /** Set by another service than the site itself. */
  thirdParty: z.boolean(),
  /** How long a cookie lasts, in whole days; null for one kept only while the browser is open, and for storage. */
  days: z.number().int().nullable(),
  /** Found before the visitor made a choice. */
  beforeConsent: z.boolean(),
  /** The first of the site's addresses it was found on. */
  page: z.string().max(500),
});
export type ScannedItem = z.infer<typeof scannedItem>;

/** A stored scan's findings; anything damaged is left out rather than failing the page. */
export function parseScannedItems(value: unknown): ScannedItem[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const parsed = scannedItem.safeParse(item);
    return parsed.success ? [parsed.data] : [];
  });
}

export const itemKey = (item: Pick<ScannedItem, "kind" | "name" | "domain">) =>
  `${item.kind}|${item.domain}|${item.name}`;

export type ScanTarget = {
  /** e.g. `https://kaizenstore.cloud`. */
  origin: string;
  /** Where to start, as paths on the origin. */
  starts: string[];
  /** Whether a path belongs to the site being scanned. */
  within: (path: string) => boolean;
  /** The consent cookie that allows everything, or null when the site asks about nothing. */
  consent: { name: string; value: string } | null;
  /** How many of the site's pages to open. */
  maxPages: number;
};

/** Two hosts belong to one site when one is the other or under it (`www.` and the like). */
export function sameSite(host: string, domain: string): boolean {
  const a = host.toLowerCase();
  const b = domain.replace(/^\./, "").toLowerCase();
  return a === b || a.endsWith(`.${b}`) || b.endsWith(`.${a}`);
}

// ---------------------------------------------------------------------------
// What an owner says about a finding, and what each finding means
// ---------------------------------------------------------------------------

export const cookieNoteInput = z.object({
  kind: z.enum(SCANNED_KINDS),
  name: z.string().trim().min(1).max(200),
  domain: z.string().trim().min(1).max(253),
  category: z.enum(CODE_CATEGORIES, { message: "Choose what the item is for." }),
  provider: z.string().trim().min(1, "Say who sets it, such as the service's name.").max(100, "Keep who sets it under 100 characters."),
  purpose: z.string().trim().min(1, "Say what it is for, as visitors will read it.").max(500, "Keep the purpose under 500 characters."),
});
export type CookieNote = z.infer<typeof cookieNoteInput>;

export type ReviewedItem = ScannedItem & {
  /** What Kaizen knows it as, if anything. */
  known: KnownCookie | null;
  /** What the owner said about it, if anything. */
  note: CookieNote | null;
  /** Its category, from Kaizen or the owner; null until described. */
  category: ConsentCategory | null;
  /**
   * `early`: optional, yet set before the visitor chose, which the law
   * forbids; `undescribed`: neither Kaizen nor the owner has said what it is.
   */
  problem: "early" | "undescribed" | null;
};

/** A scan's findings with what is known about each, faults first. */
export function reviewFindings(items: ScannedItem[], notes: CookieNote[]): ReviewedItem[] {
  const byKey = new Map(notes.map((note) => [itemKey(note), note]));
  const rank = { early: 0, undescribed: 1 } as const;
  return items
    .map((item): ReviewedItem => {
      const note = byKey.get(itemKey(item)) ?? null;
      // A storage item is known only by an entry that says it is one of that kind (D656); other entries name cookies.
      const found = note ? null : knownCookie(item.name);
      const known = found && (found.storage ? `${found.storage}Storage` === item.kind : item.kind === "cookie") ? found : null;
      const category = note?.category ?? known?.category ?? null;
      const problem =
        category && category !== "necessary" && item.beforeConsent ? "early" : category === null ? "undescribed" : null;
      return { ...item, known, note, category, problem };
    })
    .sort((a, b) => (a.problem ? rank[a.problem] : 2) - (b.problem ? rank[b.problem] : 2));
}
