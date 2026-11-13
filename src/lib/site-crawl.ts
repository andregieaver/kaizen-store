import { mayFrame } from "./support-embed";

/**
 * Reading a chat widget's websites (D583, step 2 of `docs/support-embed.md`), the pure parts: which pages a site lets us read (its
 * robots.txt, for our agent or anyone), which addresses are pages of the site (its host or `www.` twin, no file, no other site), the links
 * on a page, and the limits. The crawler (`src/server/site-crawl.ts`) lists a site's pages from its sitemap, else from the links of its
 * front page and the pages it links to, and reads each page's words into the knowledge base.
 */

/** The name our reader goes by in a site's robots.txt (a group for it wins over `*`). */
export const CRAWLER_AGENT = "KaizenaFlowBot";

/** The most pages read of one site, and the depth links are followed to when a site has no sitemap. */
export const SITE_PAGES_MAX = 100;
export const LINK_DEPTH = 2;
/** A site's pages are listed and read again this often; sooner when the owner asks. */
export const RECRAWL_DAYS = 7;
/** Per run of the five-minute job: sites listed, pages read, how many at once, and the time it may take. */
export const SITES_PER_RUN = 3;
export const PAGES_PER_RUN = 40;
export const PAGES_AT_ONCE = 4;
export const RUN_BUDGET_MS = 120_000;
/** The words of a page that are kept (the passages of a long page beyond it are not). */
export const PAGE_WORDS_MAX = 40_000;

/** Why a site's listing found no page to read. */
export const CRAWL_PROBLEMS = ["robots", "no_pages", "unreachable"] as const;
export type CrawlProblem = (typeof CRAWL_PROBLEMS)[number];
/** Why a page's last read kept nothing. */
export const PAGE_PROBLEMS = ["unreachable", "unreadable", "moved", "empty"] as const;
export type PageProblem = (typeof PAGE_PROBLEMS)[number];

// robots.txt -------------------------------------------------------------------------------------------------------------------------------

export type RobotsRules = { allow: string[]; disallow: string[] };

/**
 * The rules of a robots.txt for our agent (RFC 9309): the group that names `KaizenaFlowBot`, else the one for `*`, else none (everything
 * may be read). Groups are lines of `User-agent` followed by their rules; names are matched without case.
 */
export function robotsRules(text: string, agent: string = CRAWLER_AGENT): RobotsRules {
  type Group = { agents: string[]; allow: string[]; disallow: string[] };
  const groups: Group[] = [];
  let current: Group | null = null;
  let inAgents = false;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, "").trim();
    const match = /^([A-Za-z-]+)\s*:\s*(.*)$/.exec(line);
    if (!match) continue;
    const field = match[1].toLowerCase();
    const value = match[2].trim();
    if (field === "user-agent") {
      if (!current || !inAgents) {
        current = { agents: [], allow: [], disallow: [] };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      inAgents = true;
      continue;
    }
    inAgents = false;
    if (!current) continue;
    if (field === "allow" && value) current.allow.push(value);
    if (field === "disallow" && value) current.disallow.push(value);
  }
  const ours = groups.filter((group) => group.agents.includes(agent.toLowerCase()));
  const chosen = ours.length > 0 ? ours : groups.filter((group) => group.agents.includes("*"));
  return { allow: chosen.flatMap((group) => group.allow), disallow: chosen.flatMap((group) => group.disallow) };
}

/** How many characters of a path a rule matches, or -1: `*` matches anything, `$` ends the path. */
function ruleMatch(rule: string, path: string): number {
  const anchored = rule.endsWith("$");
  const body = anchored ? rule.slice(0, -1) : rule;
  const pattern = new RegExp(`^${body.split("*").map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join(".*")}${anchored ? "$" : ""}`);
  return pattern.test(path) ? body.length : -1;
}

/** Whether the rules let our agent read `path` (with its query): the longest matching rule decides, and Allow wins a tie. */
export function robotsAllow(rules: RobotsRules, path: string): boolean {
  const longest = (list: string[]) => Math.max(-1, ...list.map((rule) => ruleMatch(rule, path)));
  const allow = longest(rules.allow);
  const disallow = longest(rules.disallow);
  return disallow < 0 || allow >= disallow;
}

// Addresses --------------------------------------------------------------------------------------------------------------------------------

/** Addresses of files, not pages: pictures, documents, archives, media, feeds and code. */
const FILE = /\.(?:jpe?g|png|gif|webp|avif|svg|ico|bmp|tiff?|pdf|docx?|xlsx?|pptx?|odt|csv|zip|gz|tgz|rar|7z|mp3|mp4|m4a|wav|ogg|webm|mov|avi|css|js|mjs|json|xml|rss|atom|txt|woff2?|ttf|eot|exe|dmg|apk)$/i;

/**
 * The path a page of the site is read at, from an address found on it or in its sitemap, or null: only an `http(s)` address on the site's
 * host or its `www.` twin, without credentials, port, query or fragment (one page, one path), never a file and never an admin or account
 * page a visitor signs in to.
 */
export function sitePath(host: string, raw: string, base?: string): string | null {
  let url: URL;
  try {
    url = new URL(raw.trim(), base);
  } catch {
    return null;
  }
  if ((url.protocol !== "https:" && url.protocol !== "http:") || url.username || url.password || url.port) return null;
  if (!mayFrame(host, url.hostname.toLowerCase().replace(/\.$/, ""))) return null;
  let path = url.pathname.replace(/\/{2,}/g, "/");
  if (path.length > 1 && path.endsWith("/")) path = path.slice(0, -1);
  if (path.length > 500 || FILE.test(path)) return null;
  if (/^\/(?:wp-admin|wp-login\.php|admin|login|logout|signin|sign-in|account|cart|checkout|my-account)(?:\/|$)/i.test(path)) return null;
  return path;
}

/** The page addresses a page links to, on the same site, each once, in the page's order (`<a href>` only; `nofollow` links left out). */
export function linksIn(html: string, host: string, pageUrl: string): string[] {
  const found: string[] = [];
  const seen = new Set<string>();
  const base = /<base\b[^>]*\bhref\s*=\s*["']([^"']+)["']/i.exec(html)?.[1];
  let from = pageUrl;
  try {
    if (base) from = new URL(base, pageUrl).href;
  } catch {
    from = pageUrl;
  }
  for (const match of html.matchAll(/<a\b[^>]*>/gi)) {
    const tag = match[0];
    if (/\brel\s*=\s*["'][^"']*\bnofollow\b/i.test(tag)) continue;
    const href = /\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(tag);
    const value = href ? (href[1] ?? href[2] ?? href[3] ?? "") : "";
    if (!value || /^(?:mailto|tel|javascript|data):/i.test(value) || value.startsWith("#")) continue;
    const path = sitePath(host, value.replace(/&amp;/g, "&"), from);
    if (path && !seen.has(path)) {
      seen.add(path);
      found.push(path);
    }
  }
  return found;
}

/** A page's address on the site, from its path. */
export const pageUrl = (host: string, path: string): string => `https://${host}${path}`;

/** Whether a site is due to be listed again: never listed, asked for since, or listed a week ago. */
export function crawlDue(site: { discoveredAt: string | null; crawlRequestedAt: string | null }, now: number = Date.now()): boolean {
  if (site.discoveredAt === null) return true;
  if (site.crawlRequestedAt !== null && Date.parse(site.crawlRequestedAt) > Date.parse(site.discoveredAt)) return true;
  return now - Date.parse(site.discoveredAt) >= RECRAWL_DAYS * 86_400_000;
}

/** The sitemaps a robots.txt names (`Sitemap:` lines, any group), at most ten. */
export const robotsSitemaps = (text: string): string[] =>
  text
    .split(/\r?\n/)
    .map((line) => /^\s*sitemap\s*:\s*(\S+)/i.exec(line)?.[1] ?? null)
    .filter((url): url is string => url !== null)
    .slice(0, 10);
