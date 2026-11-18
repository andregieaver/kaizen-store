/**
 * Sanitising recorded events before the owner's replay player gets them (D656, `docs/heatmaps-and-recordings.md` 8.6). Recordings are
 * rrweb events that anyone may post to an open endpoint, and rrweb's player rebuilds `onerror` and every other attribute as it was, so
 * the server walks every object in the events (full snapshots, mutations, style rules, everything else) and returns a cleaned copy. The
 * input is never changed. Pure and browser-safe.
 *
 * Rule 1, the URLs that survive: a Supabase public-storage URL, kept as it is; an asset path on a store origin or a relative one
 * (`/_next/static/`, `/demo/`, `/kaizen/`, `/api/fonts/`, `/api/instagram/`), rewritten to the path alone so it loads from the admin's
 * own origin, where those paths are served too (`src/lib/store-hosts.ts` `SHARED`); its query and fragment are kept, since neither
 * reaches another host and sprites (`icons.svg#cart`) and cache keys (`?v=3`) need them; `data:image/…`; and `#…`. Every other URL
 * becomes `""`. URLs are read the way a browser reads them: tabs and newlines are removed, spaces trimmed, `\` counts as `/`, and
 * `/_next/static/../../admin` is the `/admin` it resolves to.
 *
 * Rule 2, attributes: `on*`, `srcdoc` and `ping` go; `http-equiv` takes `content` with it; every value that starts with a scheme, `//`,
 * `/` or `\` (and every value of an attribute that only holds a URL, such as `src` or `href`) goes through rule 1; `srcset` and
 * `imagesrcset` keep only their allowed candidates; `rr_dataURL` stays only as `data:image/…`, never SVG; `style` and `_cssText` are CSS (rule 3).
 *
 * Rule 3, CSS: the text is tokenised as CSS Syntax 3 does it, so escapes (`\75 rl(` is `url(`) are decoded and names compared without
 * regard to case. The arguments of `url(…)`, `src(…)`, `image-set(…)`, `-webkit-image-set(…)`, `image(…)`, `cross-fade(…)` and the
 * string of an `@import` are URLs. The text is split into items: a declaration or statement ends at `;`, a rule is its prelude and its
 * `{…}` block, whose contents are split the same way (so `@media` and nesting work). An item holding a disallowed URL is dropped whole;
 * a rule whose prelude holds one is dropped with its block. Text with no URL in it comes back unchanged, which is why the text of every
 * text node and text mutation goes through it too: a plain text node added under a `<style>` element would be CSS all the same.
 */

const ASSET_PREFIXES = [
  "/_next/static/",
  "/demo/",
  "/kaizen/",
  "/api/fonts/",
  "/api/instagram/",
] as const;
const SUPABASE_PUBLIC = "/storage/v1/object/public/";
/** A base no real URL has, to tell a relative URL from one that names a host (`//evil`, `/\evil`). */
const RELATIVE_BASE = "https://relative.kaizen.invalid";
/** Deeper than any real snapshot; a hostile one deeper still would otherwise overflow the stack. */
const MAX_DEPTH = 1500;

/** Attributes whose value is only ever a URL, checked whatever it starts with. */
const URL_ATTRIBUTES = new Set([
  "src",
  "href",
  "xlink:href",
  "action",
  "formaction",
  "poster",
  "data",
  "background",
  "cite",
  "longdesc",
  "manifest",
  "icon",
  "lowsrc",
  "dynsrc",
  "codebase",
  "archive",
]);
/** Functions whose string arguments a browser loads. */
const URL_FUNCTIONS = new Set([
  "url",
  "src",
  "image-set",
  "-webkit-image-set",
  "image",
  "cross-fade",
  "-webkit-cross-fade",
]);
/** Keys whose string value is CSS (or may become CSS), wherever they appear. */
const CSS_KEYS = new Set([
  "_cssText",
  "textContent",
  "rule",
  "replace",
  "replaceSync",
  "fontSource",
]);
const SCHEME = /^[a-z][a-z0-9+.-]*:/i;

export type ReplayOrigins = { storeOrigins: string[]; supabaseOrigin: string };

type Allowed = {
  stores: Set<string>;
  storeHosts: Set<string>;
  supabase: string | null;
};

export function sanitizeEvents(
  events: unknown[],
  allowed: ReplayOrigins,
): unknown[] {
  const ctx = context(allowed);
  return events.map((event) => walk(event, ctx, 0));
}

function originOf(value: string): string | null {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:"
      ? url.origin
      : null;
  } catch {
    return null;
  }
}

function context(allowed: ReplayOrigins): Allowed {
  const stores = new Set<string>();
  const storeHosts = new Set<string>();
  for (const origin of allowed.storeOrigins) {
    const o = originOf(origin);
    if (!o) continue;
    stores.add(o);
    storeHosts.add(new URL(o).host);
  }
  return { stores, storeHosts, supabase: originOf(allowed.supabaseOrigin) };
}

/* ------------------------------------------------------------------ rule 1 */

function normalizeUrl(raw: string): string {
  // As the URL parser does: tabs and newlines anywhere are removed, C0 controls and spaces at either end trimmed.
  return raw.replace(/[\t\n\r]/g, "").replace(/^[\u0000- ]+|[\u0000- ]+$/g, "");
}

function assetPath(url: URL): string | null {
  return ASSET_PREFIXES.some((prefix) => url.pathname.startsWith(prefix))
    ? url.pathname + url.search + url.hash
    : null;
}

function supabasePicture(url: URL, ctx: Allowed): boolean {
  return (
    ctx.supabase !== null &&
    url.origin === ctx.supabase &&
    url.pathname.startsWith(SUPABASE_PUBLIC) &&
    url.pathname.length > SUPABASE_PUBLIC.length
  );
}

/**
 * Rule 1: the URL to keep (perhaps rewritten), or `null` when it may not stay. Outside CSS (`css` false) a picture's data address may not be
 * SVG: in a frame, an object or a link an SVG document can run script, while CSS only ever draws it as a picture (review, 18 Nov 2026).
 */
function checkUrl(raw: string, ctx: Allowed, css = false): string | null {
  const value = normalizeUrl(raw);
  if (value === "") return "";
  if (value.startsWith("#")) return value;
  if (/^data:image\//i.test(value)) return css || !/^data:image\/svg/i.test(value) ? value : null;
  let url: URL;
  try {
    url = SCHEME.test(value) ? new URL(value) : new URL(value, RELATIVE_BASE);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  if (supabasePicture(url, ctx)) return SCHEME.test(value) ? value : url.href;
  if (url.origin === RELATIVE_BASE)
    return SCHEME.test(value) ? null : assetPath(url);
  // An absolute URL names its origin; a protocol-relative one only its host.
  const store = SCHEME.test(value)
    ? ctx.stores.has(url.origin)
    : ctx.storeHosts.has(url.host);
  return store ? assetPath(url) : null;
}

/* ------------------------------------------------------------------ rule 2 */

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return false;
  const proto: unknown = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/** Sets a key on a fresh object, `__proto__` included (JSON makes it an own key; plain assignment would set the prototype). */
function put(
  target: Record<string, unknown>,
  key: string,
  value: unknown,
): void {
  if (key === "__proto__")
    Object.defineProperty(target, key, {
      value,
      enumerable: true,
      writable: true,
      configurable: true,
    });
  else target[key] = value;
}

function looksLikeUrl(value: string): boolean {
  const v = normalizeUrl(value);
  return SCHEME.test(v) || v.startsWith("/") || v.startsWith("\\");
}

/** Splits a srcset as HTML does (a URL may hold commas, as `data:` ones do) and keeps the allowed candidates with their descriptors. */
function sanitizeSrcset(value: string, ctx: Allowed): string {
  const kept: string[] = [];
  const isSpace = (c: string) =>
    c === " " || c === "\t" || c === "\n" || c === "\r" || c === "\f";
  let i = 0;
  while (i < value.length) {
    while (i < value.length && (isSpace(value[i]) || value[i] === ",")) i++;
    if (i >= value.length) break;
    let end = i;
    while (end < value.length && !isSpace(value[end])) end++;
    let url = value.slice(i, end);
    let descriptor = "";
    i = end;
    if (url.endsWith(",")) {
      url = url.replace(/,+$/, "");
    } else {
      let depth = 0;
      const start = i;
      while (i < value.length && !(value[i] === "," && depth === 0)) {
        if (value[i] === "(") depth++;
        else if (value[i] === ")" && depth > 0) depth--;
        i++;
      }
      descriptor = value.slice(start, i).trim();
      i++;
    }
    const checked = checkUrl(url, ctx);
    if (checked) kept.push(descriptor ? `${checked} ${descriptor}` : checked);
  }
  return kept.join(", ");
}

/** A `style` attribute that a mutation sends as an object: `{ color: "red", background: ["url(…)", "important"] }`. */
function sanitizeStyleObject(
  style: Record<string, unknown>,
  ctx: Allowed,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [property, value] of Object.entries(style)) {
    if (typeof value === "string") put(out, property, sanitizeCss(value, ctx));
    else if (Array.isArray(value) && typeof value[0] === "string")
      put(out, property, [sanitizeCss(value[0], ctx), ...value.slice(1)]);
    else put(out, property, value);
  }
  return out;
}

function sanitizeAttributes(
  attributes: Record<string, unknown>,
  ctx: Allowed,
  depth: number,
): Record<string, unknown> {
  const keys = Object.keys(attributes);
  const httpEquiv = keys.some((key) => key.toLowerCase() === "http-equiv");
  const out: Record<string, unknown> = {};
  for (const key of keys) {
    const name = key.toLowerCase();
    if (/^on/i.test(key) || name === "srcdoc" || name === "ping") continue;
    if (httpEquiv && (name === "http-equiv" || name === "content")) continue;
    const value = attributes[key];
    if (key === "rr_dataURL") {
      if (
        typeof value === "string" &&
        /^data:image\//i.test(normalizeUrl(value)) &&
        !/^data:image\/svg/i.test(normalizeUrl(value))
      )
        put(out, key, value);
      continue;
    }
    if (typeof value !== "string") {
      put(
        out,
        key,
        name === "style" && isPlainObject(value)
          ? sanitizeStyleObject(value, ctx)
          : walk(value, ctx, depth + 1),
      );
      continue;
    }
    if (name === "srcset" || name === "imagesrcset")
      put(out, key, sanitizeSrcset(value, ctx));
    else if (name === "style" || key === "_cssText")
      put(out, key, sanitizeCss(value, ctx));
    else if (URL_ATTRIBUTES.has(name) || looksLikeUrl(value))
      put(out, key, checkUrl(value, ctx) ?? "");
    else put(out, key, value);
  }
  return out;
}

/* ------------------------------------------------------------------ the walk */

function walk(value: unknown, ctx: Allowed, depth: number): unknown {
  if (depth > MAX_DEPTH) return null;
  if (Array.isArray(value))
    return value.map((item) => walk(item, ctx, depth + 1));
  if (!isPlainObject(value)) return value;
  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    let next: unknown;
    if (key === "attributes" && isPlainObject(item))
      next = sanitizeAttributes(item, ctx, depth + 1);
    else if (typeof item === "string" && CSS_KEYS.has(key))
      next = sanitizeCss(item, ctx);
    else if (key === "texts" && Array.isArray(item))
      next = item.map((text) => walk(textMutation(text, ctx), ctx, depth + 2));
    else if (
      key === "set" &&
      isPlainObject(item) &&
      typeof item.value === "string"
    )
      next = { ...item, value: sanitizeCss(item.value, ctx) };
    else if (key === "cssTexts" && Array.isArray(item))
      next = item.map((css) =>
        typeof css === "string"
          ? sanitizeCss(css, ctx)
          : walk(css, ctx, depth + 2),
      );
    else if (key === "src" && typeof item === "string" && "rr_type" in value)
      next = checkUrl(item, ctx) ?? "";
    else next = walk(item, ctx, depth + 1);
    put(out, key, next);
  }
  return out;
}

function textMutation(text: unknown, ctx: Allowed): unknown {
  return isPlainObject(text) && typeof text.value === "string"
    ? { ...text, value: sanitizeCss(text.value, ctx) }
    : text;
}

/* ------------------------------------------------------------------ rule 3 */

type TokenType =
  | "ws"
  | "comment"
  | "string"
  | "badstring"
  | "url"
  | "badurl"
  | "function"
  | "ident"
  | "at"
  | "{"
  | "}"
  | "("
  | ")"
  | "["
  | "]"
  | ";"
  | "other";

/** One CSS token: its place in the text and, for names, strings and URLs, its value with escapes decoded. */
type Token = { type: TokenType; start: number; end: number; value: string };

const isNewline = (c: string | undefined) =>
  c === "\n" || c === "\r" || c === "\f";
const isWhitespace = (c: string | undefined) =>
  c === " " || c === "\t" || isNewline(c);
const isHex = (c: string | undefined) =>
  c !== undefined && /^[0-9a-f]$/i.test(c);
const isNameChar = (c: string | undefined) =>
  c !== undefined && (/^[a-z0-9_-]$/i.test(c) || c.charCodeAt(0) >= 0x80);

function tokenize(css: string): Token[] {
  const tokens: Token[] = [];
  const n = css.length;
  const validEscape = (i: number) =>
    css[i] === "\\" && i + 1 < n && !isNewline(css[i + 1]);

  /** Decodes the escape whose `\` is at `i`; returns the character and the index after it. */
  const escape = (i: number): [string, number] => {
    let j = i + 1;
    if (isHex(css[j])) {
      let hex = "";
      while (hex.length < 6 && isHex(css[j])) hex += css[j++];
      if (css[j] === "\r" && css[j + 1] === "\n") j += 2;
      else if (isWhitespace(css[j])) j++;
      const code = parseInt(hex, 16);
      const ok =
        code !== 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff);
      return [ok ? String.fromCodePoint(code) : "�", j];
    }
    const code = css.codePointAt(j) ?? 0xfffd;
    const ch = String.fromCodePoint(code);
    return [ch, j + ch.length];
  };

  const name = (i: number): [string, number] => {
    let out = "";
    let j = i;
    for (;;) {
      if (isNameChar(css[j])) out += css[j++];
      else if (validEscape(j)) {
        const [ch, next] = escape(j);
        out += ch;
        j = next;
      } else return [out, j];
    }
  };

  const string = (i: number): Token => {
    const quote = css[i];
    let out = "";
    let j = i + 1;
    while (j < n) {
      const c = css[j];
      if (c === quote)
        return { type: "string", start: i, end: j + 1, value: out };
      if (isNewline(c))
        return { type: "badstring", start: i, end: j, value: out };
      if (c === "\\") {
        if (j + 1 >= n) j++;
        else if (isNewline(css[j + 1]))
          j += css[j + 1] === "\r" && css[j + 2] === "\n" ? 3 : 2;
        else {
          const [ch, next] = escape(j);
          out += ch;
          j = next;
        }
      } else {
        out += c;
        j++;
      }
    }
    return { type: "string", start: i, end: n, value: out };
  };

  /** An unquoted `url(…)`; `j` is after the `(` and any spaces. */
  const url = (start: number, from: number): Token => {
    let out = "";
    let j = from;
    const bad = (): Token => {
      while (j < n && css[j] !== ")")
        j += validEscape(j) ? escape(j)[1] - j : 1;
      return { type: "badurl", start, end: Math.min(j + 1, n), value: out };
    };
    while (j < n) {
      const c = css[j];
      if (c === ")") return { type: "url", start, end: j + 1, value: out };
      if (isWhitespace(c)) {
        while (isWhitespace(css[j])) j++;
        if (j >= n) break;
        if (css[j] === ")")
          return { type: "url", start, end: j + 1, value: out };
        return bad();
      }
      if (
        c === '"' ||
        c === "'" ||
        c === "(" ||
        /[\u0000-\u0008\u000b\u000e-\u001f\u007f]/.test(c)
      )
        return bad();
      if (c === "\\") {
        if (!validEscape(j)) return bad();
        const [ch, next] = escape(j);
        out += ch;
        j = next;
      } else {
        out += c;
        j++;
      }
    }
    return { type: "url", start, end: n, value: out };
  };

  let i = 0;
  while (i < n) {
    const c = css[i];
    if (isWhitespace(c)) {
      let j = i;
      while (isWhitespace(css[j])) j++;
      tokens.push({ type: "ws", start: i, end: j, value: "" });
      i = j;
    } else if (c === "/" && css[i + 1] === "*") {
      const close = css.indexOf("*/", i + 2);
      const end = close < 0 ? n : close + 2;
      tokens.push({ type: "comment", start: i, end, value: "" });
      i = end;
    } else if (c === '"' || c === "'") {
      const token = string(i);
      tokens.push(token);
      i = token.end;
    } else if (isNameChar(c) || validEscape(i)) {
      const [value, j] = name(i);
      if (css[j] !== "(") {
        tokens.push({ type: "ident", start: i, end: j, value });
        i = j;
        continue;
      }
      if (value.toLowerCase() === "url") {
        let k = j + 1;
        while (isWhitespace(css[k])) k++;
        if (css[k] !== '"' && css[k] !== "'") {
          const token = url(i, k);
          tokens.push(token);
          i = token.end;
          continue;
        }
      }
      tokens.push({
        type: "function",
        start: i,
        end: j + 1,
        value: value.toLowerCase(),
      });
      i = j + 1;
    } else if (c === "@" && (isNameChar(css[i + 1]) || validEscape(i + 1))) {
      const [value, j] = name(i + 1);
      tokens.push({ type: "at", start: i, end: j, value: value.toLowerCase() });
      i = j;
    } else if (
      c === "{" ||
      c === "}" ||
      c === "(" ||
      c === ")" ||
      c === "[" ||
      c === "]" ||
      c === ";"
    ) {
      tokens.push({ type: c, start: i, end: i + 1, value: "" });
      i++;
    } else {
      const ch = String.fromCodePoint(css.codePointAt(i) ?? 0xfffd);
      tokens.push({ type: "other", start: i, end: i + ch.length, value: "" });
      i += ch.length;
    }
  }
  return tokens;
}

const CLOSER: Partial<Record<TokenType, TokenType>> = {
  "{": "}",
  "(": ")",
  "[": "]",
  function: ")",
};

/** For each opening token the index of the token that closes it (the token count when none does). A closer that does not match the
 *  innermost open block is an ordinary token, as in CSS. */
function partners(tokens: Token[]): number[] {
  const match = tokens.map(() => -1);
  const open: number[] = [];
  tokens.forEach((token, i) => {
    if (CLOSER[token.type]) open.push(i);
    else if (
      open.length > 0 &&
      CLOSER[tokens[open[open.length - 1]].type] === token.type
    )
      match[open.pop() as number] = i;
  });
  for (const i of open) match[i] = tokens.length;
  return match;
}

type Pass = {
  css: string;
  tokens: Token[];
  match: number[];
  ctx: Allowed;
  rewrites: Map<number, string>;
};

const quoted = (value: string) =>
  `"${value.replace(/[\\"]/g, (c) => `\\${c}`).replace(/[\n\r\f]/g, "\\a ")}"`;

/** Checks every URL in tokens [a, b): false when one may not stay; allowed ones that change are noted in `rewrites`. */
function urlsAllowed(pass: Pass, a: number, b: number): boolean {
  const { tokens } = pass;
  let first = a;
  while (
    first < b &&
    (tokens[first].type === "ws" || tokens[first].type === "comment")
  )
    first++;
  const isImport =
    first < b &&
    tokens[first].type === "at" &&
    tokens[first].value === "import";
  const functions: string[] = [];
  for (let i = a; i < b; i++) {
    const token = tokens[i];
    if (token.type === "badurl") return false;
    if (
      token.type === "function" ||
      token.type === "(" ||
      token.type === "[" ||
      token.type === "{"
    ) {
      functions.push(token.type === "function" ? token.value : "");
      continue;
    }
    if (token.type === ")" || token.type === "]" || token.type === "}") {
      functions.pop();
      continue;
    }
    const inner = functions.length > 0 ? functions[functions.length - 1] : null;
    const isUrl =
      token.type === "url" ||
      ((token.type === "string" || token.type === "badstring") &&
        (inner === null ? isImport : URL_FUNCTIONS.has(inner)));
    if (!isUrl) continue;
    if (token.type === "badstring") return false;
    const checked = checkUrl(token.value, pass.ctx, true);
    if (checked === null) return false;
    if (checked !== token.value)
      pass.rewrites.set(
        i,
        token.type === "url" ? `url(${quoted(checked)})` : quoted(checked),
      );
  }
  return true;
}

function render(pass: Pass, a: number, b: number): string {
  let out = "";
  for (let i = a; i < b; i++)
    out +=
      pass.rewrites.get(i) ??
      pass.css.slice(pass.tokens[i].start, pass.tokens[i].end);
  return out;
}

/** Tokens [a, b) as a list of items: declarations and statements up to `;`, rules up to their block's `}`. */
/** Deeper than any real style sheet; a block nested deeper is dropped whole, so a forged one cannot overflow the stack (review, 18 Nov 2026). */
const MAX_CSS_DEPTH = 64;

function sanitizeList(pass: Pass, a: number, b: number, depth = 0): string {
  const { tokens, match } = pass;
  let out = "";
  let i = a;
  while (i < b) {
    let j = i;
    let block = -1;
    while (j < b) {
      const type = tokens[j].type;
      if (type === "{") {
        block = j;
        break;
      }
      if (type === ";") break;
      j = CLOSER[type] ? Math.min(match[j], b) + 1 : j + 1;
    }
    if (block >= 0) {
      const close = Math.min(match[block], b);
      if (depth < MAX_CSS_DEPTH && urlsAllowed(pass, i, block)) {
        out +=
          render(pass, i, block + 1) +
          sanitizeList(pass, block + 1, close, depth + 1) +
          (close < b ? render(pass, close, close + 1) : "");
      }
      i = close + 1;
    } else {
      const end = Math.min(j + 1, b);
      if (urlsAllowed(pass, i, end)) out += render(pass, i, end);
      i = end;
    }
  }
  return out;
}

/** Rule 3: a style sheet, a rule, a declaration list or a value, with every item that holds a disallowed URL dropped. */
function sanitizeCss(css: string, ctx: Allowed): string {
  if (css === "") return css;
  const tokens = tokenize(css);
  const pass: Pass = {
    css,
    tokens,
    match: partners(tokens),
    ctx,
    rewrites: new Map(),
  };
  return sanitizeList(pass, 0, tokens.length);
}

/** Exported for the tests: rule 3 on one CSS text. */
export function sanitizeCssText(css: string, allowed: ReplayOrigins): string {
  return sanitizeCss(css, context(allowed));
}
