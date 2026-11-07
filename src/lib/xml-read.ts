/**
 * A small, strict XML reader (no dependency) for files people upload, such as a bank's statement (camt.053, B4 of
 * `docs/own-books-and-sales.md`): it parses a document into elements and refuses what is not well formed (a tag not closed, closed out of
 * order, an `&` that is no entity, a `<` in text, two roots, characters XML forbids). It reads no DTD and expands no entity but the five
 * XML has and character references, so a file cannot reach outside itself. Comments and processing instructions are skipped, CDATA read as
 * text. Names keep their prefix; `localName()` drops it, as a bank's file may or may not use one for its namespace.
 */

export type XmlElement = { name: string; attributes: Record<string, string>; children: XmlElement[]; text: string };

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

function decode(raw: string): string {
  return raw.replace(/&([a-z]+|#\d+|#x[0-9a-f]+);|&/gi, (_whole, name: string | undefined) => {
    if (!name) throw new Error("An & that starts no entity");
    if (name.startsWith("#x") || name.startsWith("#X")) return String.fromCodePoint(parseInt(name.slice(2), 16));
    if (name.startsWith("#")) return String.fromCodePoint(Number(name.slice(1)));
    const value = ENTITIES[name];
    if (value === undefined) throw new Error(`Unknown entity &${name};`);
    return value;
  });
}

const FORBIDDEN = /[\u0000-\u0008\u000b\u000c\u000e-\u001f￾￿]/;

/** The document's root element; throws on anything not well formed, and on a DTD (`<!DOCTYPE`), which no file of ours needs. */
export function parseXml(source: string): XmlElement {
  if (FORBIDDEN.test(source)) throw new Error("A character XML forbids");
  let rest = source.replace(/^﻿/, "");
  const stack: XmlElement[] = [];
  let root: XmlElement | null = null;
  while (rest.length > 0) {
    const lt = rest.indexOf("<");
    const text = lt === -1 ? rest : rest.slice(0, lt);
    if (text.length > 0) {
      if (stack.length === 0) {
        if (text.trim()) throw new Error("Text outside the root");
      } else stack[stack.length - 1].text += decode(text);
    }
    if (lt === -1) break;
    rest = rest.slice(lt);
    if (rest.startsWith("<?")) {
      const end = rest.indexOf("?>");
      if (end === -1) throw new Error("A processing instruction is not closed");
      rest = rest.slice(end + 2);
      continue;
    }
    if (rest.startsWith("<!--")) {
      const end = rest.indexOf("-->");
      if (end === -1) throw new Error("A comment is not closed");
      rest = rest.slice(end + 3);
      continue;
    }
    if (rest.startsWith("<![CDATA[")) {
      const end = rest.indexOf("]]>");
      if (end === -1 || stack.length === 0) throw new Error("CDATA outside an element, or not closed");
      stack[stack.length - 1].text += rest.slice(9, end);
      rest = rest.slice(end + 3);
      continue;
    }
    if (rest.startsWith("<!")) throw new Error("A DTD or declaration, which is not read");
    const close = /^<\/([A-Za-z_][\w:.-]*)\s*>/.exec(rest);
    if (close) {
      const open = stack.pop();
      if (!open || open.name !== close[1]) throw new Error(`</${close[1]}> closes ${open?.name ?? "nothing"}`);
      if (stack.length === 0) root = open;
      rest = rest.slice(close[0].length);
      continue;
    }
    const tag = /^<([A-Za-z_][\w:.-]*)((?:\s+[A-Za-z_][\w:.-]*\s*=\s*(?:"[^"<]*"|'[^'<]*'))*)\s*(\/?)>/.exec(rest);
    if (!tag) throw new Error("Not a tag");
    if (stack.length === 0 && root) throw new Error("Two roots");
    const attributes: Record<string, string> = {};
    for (const a of tag[2].matchAll(/([A-Za-z_][\w:.-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) attributes[a[1]] = decode(a[2] ?? a[3] ?? "");
    const element: XmlElement = { name: tag[1], attributes, children: [], text: "" };
    if (stack.length > 0) stack[stack.length - 1].children.push(element);
    if (tag[3] === "/") {
      if (stack.length === 0) root = element;
    } else stack.push(element);
    rest = rest.slice(tag[0].length);
  }
  if (stack.length > 0) throw new Error(`<${stack[stack.length - 1].name}> is not closed`);
  if (!root) throw new Error("No root");
  return root;
}

/** An element's name without its namespace prefix (`ns2:Ntry` is `Ntry`). */
export const localName = (element: XmlElement): string => element.name.slice(element.name.indexOf(":") + 1);

/** The children of an element with a local name. */
export const kids = (element: XmlElement | undefined, name: string): XmlElement[] => (element ? element.children.filter((c) => localName(c) === name) : []);

/** The first element down a path of local names (`at(entry, "BookgDt", "Dt")`), or undefined. */
export function at(element: XmlElement | undefined, ...path: string[]): XmlElement | undefined {
  let here = element;
  for (const name of path) {
    here = kids(here, name)[0];
    if (!here) return undefined;
  }
  return here;
}

/** The trimmed text at a path, or undefined when the element is missing or empty. */
export function textAt(element: XmlElement | undefined, ...path: string[]): string | undefined {
  const found = at(element, ...path)?.text.trim();
  return found ? found : undefined;
}

/** Every element with a local name anywhere below, in document order. */
export function descendants(element: XmlElement, name: string): XmlElement[] {
  const out: XmlElement[] = [];
  const walk = (e: XmlElement) => {
    for (const c of e.children) {
      if (localName(c) === name) out.push(c);
      walk(c);
    }
  };
  walk(element);
  return out;
}
