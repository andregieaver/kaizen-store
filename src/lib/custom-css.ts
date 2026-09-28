/**
 * Owners' own CSS (D100): for one page (`PageContent.css`, saved with it)
 * and for the whole site (`stores.custom_css`, `platform_settings.custom_css`).
 * It is shown on Kaizen's own address until stores have their own hosts
 * (P7), and in the admin's canvas, so it is checked the same in the browser
 * and on the server:
 *
 * - no `<`, which could end the page's `<style>` and start HTML;
 * - braces that balance and backslashes only in quoted text, so it cannot
 *   leave the block it is put in (the canvas's `@scope`) or hide a word;
 * - no `@import`, `@charset` or `@namespace`, and no function that loads a
 *   file other than `url()`;
 * - `url()` only to the site itself, the media library (Kaizen's storage)
 *   or a `data:` picture or font, so it never asks another site for
 *   anything: no visitor is tracked without consent (D58), and nothing on
 *   the page can be sent away.
 */

export const CSS_MAX = 50_000;

const BANNED_AT_RULES = new Set(["import", "charset", "namespace"]);
/** Functions that fetch a file by a plain string, which only `url()` may do here. */
const BANNED_FUNCTIONS = new Set(["image-set", "-webkit-image-set", "element", "-moz-element", "expression", "src"]);

/** Where the media library's files are: Kaizen's public storage. */
function storagePrefix(): string | null {
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
  return base ? `${base.replace(/\/+$/, "")}/storage/v1/object/public/` : null;
}

/** Whether CSS may load this address: the site's own, the media library's, or a `data:` picture or font. */
export function allowedCssUrl(raw: string): boolean {
  const url = raw.trim();
  if (url === "" || url.startsWith("#")) return true;
  if (url.startsWith("//")) return false;
  if (/^data:(image|font)\//i.test(url) || /^data:application\/(font|x-font)/i.test(url)) return true;
  const storage = storagePrefix();
  if (storage && url.startsWith(storage)) return true;
  // Any other scheme (https:, http:, javascript:) is another site; without one, the address is the site's own.
  return !/^[a-z][a-z0-9+.-]*:/i.test(url);
}

/** A quoted string's text, with CSS escapes read (`\\3c ` is "<"). */
function unescape(text: string): string {
  return text.replace(/\\([0-9a-fA-F]{1,6}\s?|[\s\S])/g, (_all, escape: string) => {
    const hex = escape.trim();
    if (/^[0-9a-fA-F]{1,6}$/.test(hex)) {
      const code = parseInt(hex, 16);
      return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : "�";
    }
    return escape === "\n" ? "" : escape;
  });
}

/** What is wrong with owner CSS, in words for the owner; null when it may be used. */
export function cssProblem(css: string): string | null {
  if (css.length > CSS_MAX) return `Keep the CSS under ${CSS_MAX.toLocaleString("en")} characters.`;
  if (css.includes("<")) return 'CSS cannot contain "<". Inside quotes, write it as \\3c instead.';
  let depth = 0;
  let i = 0;
  const readString = (quote: string): string | null => {
    let text = "";
    i += 1;
    while (i < css.length) {
      const char = css[i];
      if (char === "\\") {
        text += css.slice(i, i + 2);
        i += 2;
        continue;
      }
      if (char === quote) {
        i += 1;
        return text;
      }
      if (char === "\n") return null;
      text += char;
      i += 1;
    }
    return null;
  };
  while (i < css.length) {
    const char = css[i];
    if (char === "/" && css[i + 1] === "*") {
      const end = css.indexOf("*/", i + 2);
      if (end < 0) return "A comment (/* … */) is not closed.";
      i = end + 2;
      continue;
    }
    if (char === '"' || char === "'") {
      if (readString(char) === null) return "Quoted text is not closed on its line.";
      continue;
    }
    if (char === "\\") return "Backslashes can only be used inside quotes.";
    if (char === "{") depth += 1;
    if (char === "}") {
      depth -= 1;
      if (depth < 0) return "There is a } without its {.";
    }
    if (char === "@") {
      const name = /^@(-?[a-zA-Z][\w-]*)/.exec(css.slice(i))?.[1]?.toLowerCase();
      if (name && BANNED_AT_RULES.has(name)) return `@${name} cannot be used. Choose fonts under Design, and put pictures in the media library.`;
    }
    if (char === "(") {
      const name = /(-?[a-zA-Z][\w-]*)$/.exec(css.slice(Math.max(0, i - 40), i))?.[1]?.toLowerCase();
      if (name && BANNED_FUNCTIONS.has(name)) return `${name}() cannot be used here; use url() for pictures.`;
      if (name === "url") {
        i += 1;
        while (/\s/.test(css[i] ?? "")) i += 1;
        let address: string;
        if (css[i] === '"' || css[i] === "'") {
          const text = readString(css[i]);
          if (text === null) return "An address in url() is not closed.";
          address = unescape(text);
          while (/\s/.test(css[i] ?? "")) i += 1;
          if (css[i] !== ")") return "url() takes one address.";
        } else {
          const end = css.indexOf(")", i);
          if (end < 0) return "A url( is not closed.";
          address = css.slice(i, end);
          if (/["'\s(]/.test(address.trim())) return "An address in url() cannot contain quotes, spaces or brackets; put it in quotes.";
          i = end;
        }
        if (!allowedCssUrl(address)) {
          return `url(${address.trim().slice(0, 60)}) is another site. Upload pictures and fonts to the media library and use their address there.`;
        }
      }
    }
    i += 1;
  }
  if (depth > 0) return "A { is not closed.";
  return null;
}

/** The CSS for a `<style>` on the site, or nothing when it cannot be used. */
export function siteCss(css: string | null | undefined): string {
  const text = css?.trim() ?? "";
  return text && cssProblem(text) === null ? text : "";
}

/** The CSS kept inside one element and what it holds (the builder's canvas, the admin's previews). */
export function scopedCss(css: string, root: string): string {
  const text = siteCss(css);
  return text ? `@scope (${root}) {\n${text}\n}` : "";
}
