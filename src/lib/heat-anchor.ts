/**
 * What a click on a store page is kept against (D656, `docs/heatmaps-and-recordings.md` section 3, "Anchor" and "Cell"): the part of the
 * page builder it fell in (its id, the first class `kz-{id}` of every row, column and block, `partClass()`), a product card, or a landmark,
 * and where inside that box (a 10 × 10 grid). Pure: the storefront's click watch builds the chain from the DOM and passes it here, and the
 * screenshot job measures the same keys (`map-measure.ts`), so a click lands on the same part in the picture.
 */

const PART_SOURCE = "(?:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|(?:header|footer|product)(?:-[a-z]+)+)";

/** A part's id: a uuid, or a fixed id of the default header, footer or product layout (`header-row`, `header-menu-button`, `product-media`). */
export const PART_ID = new RegExp(`^${PART_SOURCE}$`);

/** Every anchor the server accepts: a landmark, a card in no part (`@card:{list}:{n}`), a part, or a card inside a part (`{part}/c{n}`). */
export const ANCHOR = new RegExp(`^(?:@body|@header|@footer|@main|@card:\\d:\\d{1,2}|${PART_SOURCE}(?:/c\\d{1,2})?)$`);
export const ANCHOR_MAX = 60;

/** The grid inside an anchor's box. */
export const CELLS = 10;

/** One element of the chain from the clicked element up to `<body>`, as the DOM layer reads it. */
export type ChainLink = {
  /** The element's first class, or null. */
  firstClass: string | null;
  /** Its tag name, lower case. */
  tag: string;
  /** It is a product card (`li.product-card`). */
  isProductCard?: boolean;
  /** For a card: its 0-based place among the cards of the nearest part around it, when there is one. */
  cardIndexInPart?: number | null;
  /** For a card: its list's 0-based place among the page's card lists, and its place in that list. */
  listIndex?: number | null;
  cardIndexInList?: number | null;
};

/** The part id of an element whose first class is a part's class, or null. */
export function partIdOf(firstClass: string | null): string | null {
  if (!firstClass?.startsWith("kz-")) return null;
  const id = firstClass.slice(3);
  return PART_ID.test(id) ? id : null;
}

/** The anchor of a click, and which link of the chain holds the box its cell is measured in; null for an empty chain. */
export function anchorOf(chain: readonly ChainLink[]): { anchor: string; at: number } | null {
  if (chain.length === 0) return null;
  const card = chain.findIndex((link) => link.isProductCard);
  const part = chain.findIndex((link) => partIdOf(link.firstClass) !== null);
  if (card >= 0 && part > card) {
    const n = chain[card].cardIndexInPart;
    if (n !== null && n !== undefined && n >= 0 && n < 100) return { anchor: `${partIdOf(chain[part].firstClass)}/c${n}`, at: card };
  }
  if (part >= 0) return { anchor: partIdOf(chain[part].firstClass)!, at: part };
  if (card >= 0) {
    const { listIndex: list, cardIndexInList: n } = chain[card];
    if (list !== null && list !== undefined && n !== null && n !== undefined && list >= 0 && list < 10 && n >= 0 && n < 100) {
      return { anchor: `@card:${list}:${n}`, at: card };
    }
  }
  for (const tag of ["header", "footer", "main"] as const) {
    const at = chain.findIndex((link) => link.tag === tag);
    if (at >= 0) return { anchor: `@${tag}`, at };
  }
  return { anchor: "@body", at: chain.length - 1 };
}

/** Where in a box a click fell, as a cell of the 10 × 10 grid (each 0..9). */
export function cellOf(clientX: number, clientY: number, rect: { left: number; top: number; width: number; height: number }): [number, number] {
  const cell = (offset: number, size: number) => (size > 0 ? Math.min(CELLS - 1, Math.max(0, Math.floor((CELLS * offset) / size))) : 0);
  return [cell(clientX - rect.left, rect.width), cell(clientY - rect.top, rect.height)];
}

/** Elements a click on cannot be dead: typing, choosing, media and frames (Datadog's set, plus ours). */
const NOT_CANDIDATE = new Set(["input", "textarea", "select", "option", "label", "canvas", "video", "audio", "embed", "object", "iframe", "html", "body"]);

/** Whether a click on this element may be judged dead: never on a field, a label, media, a frame or the page itself. */
export const isCandidateTarget = (tag: string, contentEditable: boolean): boolean => !contentEditable && !NOT_CANDIDATE.has(tag.toLowerCase());

/** Input types where repeated clicks select text, so they never make a rage click (PostHog's list). */
const TEXT_INPUTS = new Set(["", "text", "search", "email", "password", "url", "tel", "number"]);

/** Whether a click may start or join a rage run: not on text fields, selects or editable text. */
export function isRageable(tag: string, inputType: string | null, contentEditable: boolean): boolean {
  const name = tag.toLowerCase();
  if (contentEditable || name === "textarea" || name === "select") return false;
  return !(name === "input" && TEXT_INPUTS.has((inputType ?? "").toLowerCase()));
}
