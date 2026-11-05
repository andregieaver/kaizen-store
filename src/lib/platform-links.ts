import { platformPath, type PlatformLang } from "./platform-lang";
import { siteUrl } from "./site";
import { themesHost } from "./theme-host";

/**
 * Links on Kaizena Flow's own pages in another language (D312 P4): a page, header or footer is written once, in English, with English
 * addresses (`/sign-up`, `/compare`, `https://themes.kaizenaflow.com/`); drawn in Norwegian, each of the site's own addresses takes the
 * language's prefix, so a visitor who follows a button or a link in a text stays in Norwegian. Anything else is as written: another site,
 * a store's address, the admin, a file, an anchor alone, `mailto:` (`platformPath()` says which). Menus have their own words and links
 * per language already (D85).
 */

/** The site's own hosts, whose full addresses are links to its pages: Kaizena Flow's (with and without `www.`) and the theme store's. */
export type OwnHosts = { site: string; themes: string | null };

export function ownHosts(): OwnHosts {
  return { site: new URL(siteUrl()).host.replace(/^www\./, ""), themes: themesHost() };
}

/** One link as it goes in `lang`: a path or a full address on one of the site's own hosts takes the prefix; anything else is as written. */
export function linkIn(href: string, lang: PlatformLang, hosts: OwnHosts): string {
  if (lang === "en") return href;
  const trimmed = href.trim();
  if (trimmed.startsWith("/")) return platformPath(lang, trimmed);
  if (!/^https?:\/\//i.test(trimmed)) return href;
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return href;
  }
  const host = url.host.toLowerCase().replace(/^www\./, "");
  if (host !== hosts.site && host !== hosts.themes) return href;
  const localized = platformPath(lang, `${url.pathname}${url.search}${url.hash}`);
  return `${url.protocol}//${url.host}${localized}`;
}

/** The fields that hold a link's address, wherever they are in a page (a button, a text's link, a list's line, a column, a grid's item). */
const LINK_FIELDS = new Set(["href", "buttonHref", "ctaHref"]);
/** Never rewritten: code the owner wrote (an HTML part, CSS) and the texts kept per language, which are laid over the page already. */
const LEFT_AS_WRITTEN = new Set(["html", "css", "translations"]);
/** A link inside a text's own inline HTML (`<a href="/dream-factory">` in a heading). */
const INLINE_LINK = /\bhref=(["'])(.*?)\1/g;

/**
 * The page (or header or footer) with every link to the site's own pages in `lang`. English is the page as it is. Meant for content already
 * in `lang` (`localizePage()`), as the site draws it; the builder and stored pages keep their English addresses.
 */
export function linksIn<T>(content: T, lang: PlatformLang, hosts: OwnHosts = ownHosts()): T {
  if (lang === "en") return content;
  const walk = (node: unknown, field?: string): unknown => {
    if (typeof node === "string") {
      if (field && LINK_FIELDS.has(field)) return linkIn(node, lang, hosts);
      return node.includes("href=") ? node.replace(INLINE_LINK, (_, quote: string, href: string) => `href=${quote}${linkIn(href, lang, hosts)}${quote}`) : node;
    }
    if (Array.isArray(node)) return node.map((item) => walk(item));
    if (node && typeof node === "object") {
      return Object.fromEntries(Object.entries(node).map(([key, value]) => [key, LEFT_AS_WRITTEN.has(key) ? value : walk(value, key)]));
    }
    return node;
  };
  return walk(content) as T;
}
