import type { ReactNode } from "react";

/**
 * React elements written out as static HTML (D695 step 3's fix, 19 November 2026), for the documents' PDFs: the same markup
 * `renderToStaticMarkup()` writes for the views it is given (`OrderDocumentView`, `ContractDocumentView`, `ContractAuditView`), without
 * `react-dom/server`. Next refuses that module in a route's own code, and loading it from disk at run time needed files a Vercel function
 * does not carry: a contract could not be sent (`Cannot find module 'react-dom/server'`). The views are plain markup: host elements,
 * function components without hooks, fragments, arrays, text and numbers, `className`, a few style objects and one `<style>`. Anything
 * else (a hook, context, a class component, a portal) throws rather than render something else. `static-markup.test.ts` and the views'
 * own tests hold every document's output to `renderToStaticMarkup()`'s. Pure.
 */

const ELEMENT = Symbol.for("react.transitional.element");
const LEGACY_ELEMENT = Symbol.for("react.element");
const FRAGMENT = Symbol.for("react.fragment");

/** Elements written `<br/>`, with no closing tag. */
const VOID = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track", "wbr"]);

/** The props React writes under another name; any other (colSpan, scope, aria-label) keeps its own, as React 19 writes it. */
const ATTRIBUTE_NAMES: Record<string, string> = {
  className: "class",
  htmlFor: "for",
  acceptCharset: "accept-charset",
  httpEquiv: "http-equiv",
};

/** Style properties whose numbers have no unit (React's list, those a document could use). */
const UNITLESS = new Set([
  "animationIterationCount", "aspectRatio", "columnCount", "columns", "flex", "flexGrow", "flexShrink", "fontWeight", "gridColumn",
  "gridRow", "lineClamp", "lineHeight", "opacity", "order", "orphans", "tabSize", "widows", "zIndex", "zoom",
]);

const ESCAPES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#x27;" };
const escape = (text: string) => text.replace(/[&<>"']/g, (c) => ESCAPES[c]);

const kebab = (name: string) => (name.startsWith("--") ? name : name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`).replace(/^ms-/, "-ms-"));

function styleText(style: Record<string, unknown>): string {
  const parts: string[] = [];
  for (const [name, value] of Object.entries(style)) {
    if (value === null || value === undefined || typeof value === "boolean" || value === "") continue;
    const text = typeof value === "number" && value !== 0 && !UNITLESS.has(name) && !name.startsWith("--") ? `${value}px` : String(value).trim();
    parts.push(`${kebab(name)}:${text}`);
  }
  return parts.join(";");
}

function attributes(props: Record<string, unknown>): string {
  let out = "";
  for (const [name, value] of Object.entries(props)) {
    if (name === "children" || name === "key" || name === "ref" || name === "dangerouslySetInnerHTML" || name === "suppressHydrationWarning") continue;
    if (value === null || value === undefined || typeof value === "function" || typeof value === "symbol") continue;
    if (name === "style") {
      const text = styleText(value as Record<string, unknown>);
      if (text) out += ` style="${escape(text)}"`;
      continue;
    }
    const html = ATTRIBUTE_NAMES[name] ?? name;
    const isData = html.startsWith("data-") || html.startsWith("aria-");
    if (typeof value === "boolean") {
      // aria-* and data-* write true and false as words; the others are present or left out.
      if (isData) out += ` ${html}="${value}"`;
      else if (value) out += ` ${html}=""`;
      continue;
    }
    out += ` ${html}="${escape(String(value))}"`;
  }
  return out;
}

type ElementLike = { $$typeof: symbol; type: unknown; props: Record<string, unknown> };
const isElement = (node: unknown): node is ElementLike =>
  typeof node === "object" && node !== null && ((node as ElementLike).$$typeof === ELEMENT || (node as ElementLike).$$typeof === LEGACY_ELEMENT);

function render(node: unknown, inRawText: boolean): string {
  if (node === null || node === undefined || typeof node === "boolean") return "";
  if (typeof node === "string") return inRawText ? node : escape(node);
  if (typeof node === "number" || typeof node === "bigint") return String(node);
  if (Array.isArray(node)) return node.map((child) => render(child, inRawText)).join("");
  if (!isElement(node)) throw new Error("static-markup: a child that is not an element, text or a list");
  const { type, props } = node;
  if (type === FRAGMENT) return render(props.children, inRawText);
  if (typeof type === "function") {
    if ((type as { prototype?: { isReactComponent?: unknown } }).prototype?.isReactComponent) throw new Error("static-markup: a class component");
    return render((type as (p: Record<string, unknown>) => ReactNode)(props), inRawText);
  }
  if (typeof type !== "string") throw new Error("static-markup: an element type it cannot write");
  const open = `<${type}${attributes(props)}`;
  if (VOID.has(type)) return `${open}/>`;
  const inner = props.dangerouslySetInnerHTML
    ? String((props.dangerouslySetInnerHTML as { __html?: unknown }).__html ?? "")
    : render(props.children, type === "style" || type === "script");
  return `${open}>${inner}</${type}>`;
}

/** The element as `renderToStaticMarkup()` writes it, for the views above. */
export function staticMarkup(node: ReactNode): string {
  return render(node, false);
}
