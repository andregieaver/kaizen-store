/**
 * Chat widgets on the owner's own websites (D582, `docs/support-embed.md`), the pure parts: what a site's address may be, the key a
 * widget's tag carries, the tag itself, how the tag is found on a site's front page, and which hosts may frame the chat. A desk has any
 * number of widgets (each with its own look, `support-widget-style.ts`), and each widget any number of sites; a site is one host, written
 * as the owner typed it or pasted from the address bar (`normalizeHost()`), and its `www.` twin is the same site (`framingHosts()`).
 *
 * The chat is drawn in a frame from Kaizena Flow (`/embed/chat/{key}/{host}`), so its requests stay on Kaizena Flow's own origin and the
 * chat's routes keep refusing every other site (`sameSite()`); only the hosts of a site whose tag was found may frame it (`frame-ancestors`
 * in `next.config.ts`, `embedFrameHeaders()`), and the page draws the chat only for those hosts.
 */

/** Widgets per desk, and sites per widget. */
export const WIDGETS_MAX = 20;
export const SITES_MAX = 20;
/** A widget's name, as the owner tells their widgets apart. */
export const WIDGET_NAME_MAX = 60;

/** The key a widget's tag carries: public (anyone can read it in the site's HTML), so it proves nothing on its own. */
export const EMBED_KEY = /^[a-z0-9]{20}$/;

/** A host as stored: lower case, letters, digits and hyphens in dotted labels, at least two labels, no port. */
const HOST = /^(?=.{4,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

/** Hosts that are never an owner's own site: Kaizena Flow's, and names that only reach a computer of one's own. */
const NEVER = [/(^|\.)localhost$/, /\.local$/, /\.test$/, /\.internal$/, /\.example$/, /\.invalid$/];

/** Whether `host` is a host as stored (see `HOST`). */
export const isHost = (host: string): boolean => HOST.test(host) && !NEVER.some((rule) => rule.test(host));

/**
 * The host the owner means, from what they typed: `Example.com`, `https://www.example.com/contact` and `www.example.com.` are all a
 * host; null for anything that is not (an IP address, a port, credentials, a path alone, a name that reaches no public site).
 */
export function normalizeHost(input: string): string | null {
  const raw = input.trim().toLowerCase();
  if (!raw || raw.length > 300) return null;
  let url: URL;
  try {
    url = new URL(/^[a-z][a-z0-9+.-]*:\/\//.test(raw) ? raw : `https://${raw}`);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  if (url.username || url.password || url.port) return null;
  const host = url.hostname.replace(/\.$/, "");
  return isHost(host) ? host : null;
}

/** A host and its `www.` twin: the same site, either of which may frame the chat. */
export function framingHosts(host: string): string[] {
  const twin = host.startsWith("www.") ? host.slice(4) : `www.${host}`;
  return isHost(twin) ? [host, twin] : [host];
}

/** Whether a page on `asked` may show the chat of the site registered as `host`. */
export const mayFrame = (host: string, asked: string): boolean => framingHosts(host).includes(asked);

/** The privacy page the chat's notice links on the widget's sites: an `https` address of a public site, or null for none. */
export function privacyUrlFor(input: string): string | null | "invalid" {
  const raw = input.trim();
  if (!raw) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return "invalid";
  }
  if (url.protocol !== "https:" || url.username || url.password || url.port || !isHost(url.hostname) || url.href.length > 500) return "invalid";
  return url.href;
}

/** The tag the owner puts in the footer of each of a widget's sites: the loader, from Kaizena Flow's own origin, with the widget's key. */
export function embedTag(origin: string, key: string): string {
  return `<script src="${origin}/embed/chat.js" data-key="${key}" async></script>`;
}

/**
 * Whether the site's front page carries the tag with this key: the key in a `data-key` attribute of a script whose source is the
 * loader. Another site's key, or the key alone in the text, is no tag.
 */
export function tagFoundIn(html: string, key: string): boolean {
  if (!EMBED_KEY.test(key)) return false;
  for (const match of html.matchAll(/<script\b[^>]*>/gi)) {
    const tag = match[0];
    if (/\bsrc\s*=\s*["']?[^"'\s>]*\/embed\/chat\.js\b/i.test(tag) && new RegExp(`\\bdata-key\\s*=\\s*["']?${key}["'\\s>]`, "i").test(tag)) return true;
  }
  return false;
}

/** The DNS record that proves the site when the tag is added by a tag manager and is not in the page's HTML. */
export const dnsRecordFor = (key: string): string => `kaizena-flow-chat=${key}`;

/** Whether one of a host's TXT records is the site's (each record as its strings, joined). */
export const dnsFound = (records: string[][], key: string): boolean => records.some((parts) => parts.join("").trim() === dnsRecordFor(key));

/** Why a site's tag was not found, as the admin says it. */
export const CHECK_PROBLEMS = ["unreachable", "not_found", "moved"] as const;
export type CheckProblem = (typeof CHECK_PROBLEMS)[number];

/** A site not yet found is checked again when its chat is first opened there, at most this often. */
export const RECHECK_MINUTES = 10;

/** Whether a site not yet found may be checked again now, from when it was last checked. */
export const mayRecheck = (checkedAt: string | null, now: number = Date.now()): boolean =>
  checkedAt === null || now - Date.parse(checkedAt) >= RECHECK_MINUTES * 60_000;

/** The frame's address for a site: its key and the host of the page that shows it, with that page's path. */
export const framePath = (key: string, host: string): string => `/embed/chat/${key}/${host}`;

/**
 * The frame's own `frame-ancestors`, from its address (`next.config.ts`): only the page's host may frame it. The page itself checks that
 * the host is the site's (`mayFrame()`), so a host that is not draws nothing even where it is let frame.
 */
export function embedFrameHeaders(): { source: string; headers: { key: string; value: string }[] }[] {
  return [
    {
      source: "/embed/chat/:key([a-z0-9]{20})/:host([a-z0-9.-]{4,253})",
      headers: [{ key: "Content-Security-Policy", value: "frame-ancestors https://:host" }],
    },
  ];
}

/**
 * What the frame tells the page that holds it (`public/embed/chat.js` reads it), whenever it changes: whether the chat is open, the side
 * it sits on, the room its closed button needs (measured, so any words and offset fit) and the open panel's width on a large screen.
 */
export type FrameMessage = { kaizenaChat: "state"; open: boolean; side: "left" | "right"; width: number; height: number; panel: number };
