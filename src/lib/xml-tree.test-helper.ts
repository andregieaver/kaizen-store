/**
 * A small, strict XML reader for tests (no dependency): it parses a document into elements, refuses what is not well formed (a tag not
 * closed, closed out of order, an `&` that is no entity, a `<` in text, two roots, characters XML forbids) and decodes the five entities.
 * Enough to hold a feed the site writes to being a document a feed reader can read, not a general parser.
 */

export type XmlElement = { name: string; attributes: Record<string, string>; children: XmlElement[]; text: string };

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

function decode(raw: string): string {
  return raw.replace(/&([a-z]+|#\d+|#x[0-9a-f]+);|&/gi, (whole, name: string | undefined) => {
    if (!name) throw new Error("An & that starts no entity");
    if (name.startsWith("#x")) return String.fromCodePoint(parseInt(name.slice(2), 16));
    if (name.startsWith("#")) return String.fromCodePoint(Number(name.slice(1)));
    const value = ENTITIES[name];
    if (value === undefined) throw new Error(`Unknown entity &${name};`);
    return value;
  });
}

const FORBIDDEN = /[\u0000-\u0008\u000b\u000c\u000e-\u001f￾￿]/;

export function parseXml(source: string): XmlElement {
  if (FORBIDDEN.test(source)) throw new Error("A character XML forbids");
  let rest = source.replace(/^<\?xml[^?]*\?>\s*/, "");
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
    const close = /^<\/([A-Za-z_][\w:.-]*)\s*>/.exec(rest);
    if (close) {
      const open = stack.pop();
      if (!open || open.name !== close[1]) throw new Error(`</${close[1]}> closes ${open?.name ?? "nothing"}`);
      if (stack.length === 0) root = open;
      rest = rest.slice(close[0].length);
      continue;
    }
    const tag = /^<([A-Za-z_][\w:.-]*)((?:\s+[A-Za-z_][\w:.-]*\s*=\s*(?:"[^"<]*"|'[^'<]*'))*)\s*(\/?)>/.exec(rest);
    if (!tag) throw new Error(`Not a tag: ${rest.slice(0, 30)}`);
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

export const childrenNamed = (element: XmlElement, name: string): XmlElement[] => element.children.filter((c) => c.name === name);
export const childText = (element: XmlElement, name: string): string | undefined => childrenNamed(element, name)[0]?.text;
