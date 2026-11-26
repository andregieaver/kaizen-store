/**
 * Admin recordings' scrubber (D895 phase 3b, `docs/dpia-admin-use.md` section 2): what the server keeps of a segment of an owner's own use
 * of the admin. The admin is full of shoppers' data, and rrweb's own masking hides text nodes but not attributes (`aria-label`, `title`,
 * `alt`, `placeholder`, `value`, `data-*`, a link's address), so the server keeps only the shape of the screen and what the person did:
 *
 * - every text node, comment and text mutation becomes `•••` (whitespace stays, so the layout does), except a `<style>` element's text;
 * - an element keeps only the attributes in `KEPT_ATTRIBUTES` (layout and state, never words or addresses); every other one goes;
 * - an input event keeps whether a box is ticked, never what was typed;
 * - a Meta event's address becomes the screen's key; a `kz-page` event must name a measured screen; other custom and plugin events go.
 *
 * The result is a new object; the input is never changed. Pure and browser-safe. What the player later shows goes through
 * `sanitizeEvents()` as every recording does.
 */

import { isMeasuredScreen } from "./admin-screens";

/** Attributes that describe layout or state, never words a person wrote or an address. */
export const KEPT_ATTRIBUTES = new Set([
  "class",
  "style",
  "type",
  "role",
  "width",
  "height",
  "colspan",
  "rowspan",
  "rows",
  "cols",
  "disabled",
  "hidden",
  "open",
  "checked",
  "selected",
  "multiple",
  "tabindex",
  "aria-hidden",
  "aria-expanded",
  "aria-selected",
  "aria-checked",
  "aria-disabled",
  "aria-current",
  "dir",
  "viewbox",
  "viewBox",
  "fill",
  "stroke",
  "stroke-width",
  "d",
  "cx",
  "cy",
  "r",
  "x",
  "y",
  "x1",
  "x2",
  "y1",
  "y2",
  "points",
  "transform",
  "rr_width",
  "rr_height",
  "_cssText",
]);

const MASK = "•••";
const MAX_DEPTH = 1500;

/** Text with every run of non-space characters hidden; whitespace alone is kept as it is. */
export const maskText = (text: string) => (text.trim() === "" ? text : MASK);

function keptAttributes(attributes: unknown): Record<string, unknown> {
  if (!attributes || typeof attributes !== "object") return {};
  const out: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(attributes as Record<string, unknown>)) {
    if (!KEPT_ATTRIBUTES.has(name)) continue;
    // A layout value is short and never a URL; anything else goes as if the attribute were not kept.
    if (typeof value === "string" && name !== "style" && name !== "_cssText" && name !== "class" && name !== "d" && name !== "points" && value.length > 200) continue;
    if (typeof value === "string" && /^\s*(?:[a-z][a-z0-9+.-]*:|\/\/|\/|\\)/i.test(value) && name !== "style" && name !== "_cssText" && name !== "d") continue;
    out[name] = value;
  }
  return out;
}

/** A serialised node (rrweb's `serializedNode`) and its children, scrubbed. `inStyle` says the parent is a `<style>`. */
function scrubNode(node: unknown, depth: number, inStyle = false): unknown {
  if (!node || typeof node !== "object" || depth > MAX_DEPTH) return null;
  const n = node as Record<string, unknown>;
  const out: Record<string, unknown> = { ...n };
  if (typeof n.textContent === "string") out.textContent = inStyle || n.isStyle === true ? n.textContent : maskText(n.textContent);
  if ("attributes" in n) out.attributes = keptAttributes(n.attributes);
  if (Array.isArray(n.childNodes)) {
    const style = typeof n.tagName === "string" && n.tagName.toLowerCase() === "style";
    out.childNodes = n.childNodes.map((child) => scrubNode(child, depth + 1, style)).filter((child) => child !== null);
  }
  return out;
}

type Event = { type: number; timestamp: number; data?: unknown };

/** Mutation, input and other incremental data, scrubbed (`source` 0 mutations, 5 input; the rest has no words). */
function scrubIncremental(data: Record<string, unknown>): Record<string, unknown> {
  const out = { ...data };
  if (data.source === 0) {
    if (Array.isArray(data.texts)) out.texts = data.texts.map((t) => (t && typeof t === "object" ? { ...(t as object), value: typeof (t as { value?: unknown }).value === "string" ? maskText((t as { value: string }).value) : null } : t));
    if (Array.isArray(data.attributes)) out.attributes = data.attributes.map((a) => (a && typeof a === "object" ? { ...(a as object), attributes: keptAttributes((a as { attributes?: unknown }).attributes) } : a));
    if (Array.isArray(data.adds)) out.adds = data.adds.map((a) => (a && typeof a === "object" ? { ...(a as object), node: scrubNode((a as { node?: unknown }).node, 0) } : a));
  }
  if (data.source === 5) {
    out.text = "";
    delete out.userTriggered;
  }
  return out;
}

/**
 * The events of one segment as they are kept, for a recording whose screens are `screens` (keys checked by the caller); null when an event
 * names a screen that is never measured, so the whole segment is refused.
 */
export function scrubAdminEvents(events: readonly Event[], screen: string): Event[] | null {
  const kept: Event[] = [];
  for (const event of events) {
    const data = event.data && typeof event.data === "object" ? (event.data as Record<string, unknown>) : {};
    switch (event.type) {
      case 2:
        kept.push({ ...event, data: { ...data, node: scrubNode(data.node, 0) } });
        break;
      case 3:
        kept.push({ ...event, data: scrubIncremental(data) });
        break;
      case 4:
        kept.push({ ...event, data: { width: data.width, height: data.height, href: screen } });
        break;
      case 5: {
        const payload = data.payload && typeof data.payload === "object" ? (data.payload as Record<string, unknown>) : {};
        if (data.tag === "kz-page") {
          if (typeof payload.path !== "string" || !isMeasuredScreen(payload.path)) return null;
          kept.push({ ...event, data: { tag: "kz-page", payload: { path: payload.path } } });
        } else if (data.tag === "kz-click") {
          kept.push({ ...event, data: { tag: "kz-click", payload: { dead: payload.dead === true, rage: payload.rage === true, x: Number(payload.x) || 0, y: Number(payload.y) || 0 } } });
        }
        break;
      }
      case 0:
      case 1:
        kept.push({ type: event.type, timestamp: event.timestamp });
        break;
      default:
        // Plugin events (6) and anything else: nothing is kept.
        break;
    }
  }
  return kept;
}
