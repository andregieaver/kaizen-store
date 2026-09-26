import type { Browser, BrowserContext, Page } from "playwright-core";
import { z } from "zod";

import { CONSENT_CATEGORIES, knownCookie, type ConsentCategory, type KnownCookie } from "./cookie-consent";

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

/** Addresses a visitor opens by following links, never ones that act or need a token. */
const SKIPPED = /^\/(api|admin|auth|_next)(\/|$)|\/(checkout|cart\/restore|unsubscribe|download|order)(\/|$)|\.[a-z0-9]{2,4}$/i;

/** Two hosts belong to one site when one is the other or under it (`www.` and the like). */
export function sameSite(host: string, domain: string): boolean {
  const a = host.toLowerCase();
  const b = domain.replace(/^\./, "").toLowerCase();
  return a === b || a.endsWith(`.${b}`) || b.endsWith(`.${a}`);
}

type Found = Map<string, ScannedItem>;

/** What a page's frames keep in their storage, by frame host. */
async function storageOf(page: Page): Promise<{ kind: ScannedKind; name: string; host: string }[]> {
  const found: { kind: ScannedKind; name: string; host: string }[] = [];
  for (const frame of page.frames()) {
    let host: string;
    try {
      host = new URL(frame.url()).hostname;
    } catch {
      continue;
    }
    if (!host) continue;
    const keys = await frame
      .evaluate(() => ({ local: Object.keys(window.localStorage), session: Object.keys(window.sessionStorage) }))
      .catch(() => null);
    if (!keys) continue;
    for (const name of keys.local) found.push({ kind: "localStorage", name, host });
    for (const name of keys.session) found.push({ kind: "sessionStorage", name, host });
  }
  return found;
}

async function record(context: BrowserContext, page: Page, path: string, siteHost: string, beforeConsent: boolean, found: Found) {
  const now = Date.now();
  const add = (item: ScannedItem) => {
    const key = itemKey(item);
    if (!found.has(key)) found.set(key, item);
  };
  for (const cookie of await context.cookies()) {
    const domain = cookie.domain.replace(/^\./, "");
    add({
      kind: "cookie",
      name: cookie.name.slice(0, 200),
      domain,
      thirdParty: !sameSite(siteHost, domain),
      days: cookie.expires > 0 ? Math.max(0, Math.round((cookie.expires * 1000 - now) / 86_400_000)) : null,
      beforeConsent,
      page: path,
    });
  }
  for (const { kind, name, host } of await storageOf(page)) {
    add({ kind, name: name.slice(0, 200), domain: host, thirdParty: !sameSite(siteHost, host), days: null, beforeConsent, page: path });
  }
}

/** Opens a page and lets its scripts run a moment, as a visitor would. */
async function open(page: Page, url: string): Promise<boolean> {
  try {
    const response = await page.goto(url, { waitUntil: "load", timeout: 20_000 });
    await page.waitForLoadState("networkidle", { timeout: 3_000 }).catch(() => {});
    return response !== null && response.status() < 400;
  } catch {
    return false;
  }
}

/** The site's own links on a page, as paths without query or fragment. */
async function linksOn(page: Page, target: ScanTarget): Promise<string[]> {
  const hrefs = await page.$$eval("a[href]", (links) => links.map((a) => (a as HTMLAnchorElement).href)).catch(() => []);
  const origin = new URL(target.origin).origin;
  return hrefs.flatMap((href) => {
    try {
      const url = new URL(href);
      if (url.origin !== origin || SKIPPED.test(url.pathname) || !target.within(url.pathname)) return [];
      return [url.pathname.replace(/\/$/, "") || "/"];
    } catch {
      return [];
    }
  });
}

/**
 * One visit: a new browser profile opens the site's pages (following its
 * links, or the given list) and records what it finds after each.
 */
async function visit(browser: Browser, target: ScanTarget, pages: string[] | null, beforeConsent: boolean, found: Found) {
  const context = await browser.newContext({ locale: "en-GB" });
  try {
    if (!beforeConsent && target.consent) {
      await context.addCookies([{ ...target.consent, url: target.origin }]);
    }
    const page = await context.newPage();
    const siteHost = new URL(target.origin).hostname;
    const queue = [...(pages ?? target.starts)];
    const seen = new Set(queue);
    const opened: string[] = [];
    while (queue.length > 0 && opened.length < target.maxPages) {
      const path = queue.shift()!;
      if (!(await open(page, new URL(path, target.origin).href))) continue;
      opened.push(path);
      await record(context, page, path, siteHost, beforeConsent, found);
      // The first visit follows links; the second opens the same pages.
      if (pages === null) {
        for (const link of await linksOn(page, target)) {
          if (!seen.has(link)) {
            seen.add(link);
            queue.push(link);
          }
        }
      }
    }
    return opened;
  } finally {
    await context.close();
  }
}

/** Scans a site: without a choice, then (if the site asks) with everything allowed. */
export async function scanSite(browser: Browser, target: ScanTarget): Promise<{ pages: string[]; items: ScannedItem[] }> {
  const found: Found = new Map();
  const pages = await visit(browser, target, null, true, found);
  if (pages.length === 0) throw new Error(`None of the site's pages opened at ${target.origin}.`);
  if (target.consent) await visit(browser, target, pages, false, found);
  const items = [...found.values()].sort(
    (a, b) => a.kind.localeCompare(b.kind) || a.domain.localeCompare(b.domain) || a.name.localeCompare(b.name),
  );
  return { pages, items };
}

// ---------------------------------------------------------------------------
// What an owner says about a finding, and what each finding means
// ---------------------------------------------------------------------------

export const cookieNoteInput = z.object({
  kind: z.enum(SCANNED_KINDS),
  name: z.string().trim().min(1).max(200),
  domain: z.string().trim().min(1).max(253),
  category: z.enum(CONSENT_CATEGORIES, { message: "Choose what the item is for." }),
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
      const known = note || item.kind !== "cookie" ? null : knownCookie(item.name);
      const category = note?.category ?? known?.category ?? null;
      const problem =
        category && category !== "necessary" && item.beforeConsent ? "early" : category === null ? "undescribed" : null;
      return { ...item, known, note, category, problem };
    })
    .sort((a, b) => (a.problem ? rank[a.problem] : 2) - (b.problem ? rank[b.problem] : 2));
}
