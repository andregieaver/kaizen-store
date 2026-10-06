/**
 * The draft editor's state and how it becomes what the server saves (wave 3, run 2, D173, `docs/wave-3-orders.md` 2.4). Pure: no server import, so the editor (a client component), its view tests and
 * the unit tests read the same functions. The editor holds typed text (a price is "249,00", a percent "10,5"); `inputFromForm()` writes it as the `draftInput` the server validates again, and
 * `formFromDraft()` reads a saved draft back into typed text. Nothing here prices anything: the summary is always the server's (`previewDraft()`).
 */
import { formatPercentBps } from "./draft-input";
import { formatPriceInput } from "./product-input";

export type EditorAddress = { name: string; line1: string; line2: string; postalCode: string; city: string; country: string };

export type EditorLine = {
  /** A client-only key that stays with the line while it is edited and moved. */
  key: string;
  kind: "goods" | "custom";
  variantId: string | null;
  title: string;
  /** Goods: the variant's SKU, shown (not sent). */
  sku: string;
  quantity: number;
  /** Typed price, VAT included, in the draft's currency. Empty on a catalogue line is the market's list price. */
  price: string;
  vatCategory: string;
  /** The market's list price as shown when the line was added or last saved, as typed text; null for a custom item. Shown as the placeholder. */
  listPrice: string | null;
};

export type EditorDiscount = { kind: "percent" | "amount"; value: string; label: string };

export type EditorState = {
  marketSlug: string;
  customerId: string | null;
  email: string;
  phone: string;
  shippingAddress: EditorAddress;
  billingAddress: EditorAddress;
  companyName: string;
  organisationNumber: string;
  noteToBuyer: string;
  internalNote: string;
  tags: string[];
  discount: EditorDiscount | null;
  shipping: { kind: "rate" | "free" | "custom"; price: string };
  lines: EditorLine[];
};

/** What the page gives the editor of a saved draft (the structural part of `DraftView`). */
export type DraftLike = {
  marketSlug: string;
  currency: string;
  customerId: string | null;
  email: string | null;
  phone: string | null;
  shippingAddress: Record<string, string | null>;
  billingAddress: Record<string, string | null>;
  companyName: string | null;
  organisationNumber: string | null;
  noteToBuyer: string | null;
  internalNote: string | null;
  tags: string[];
  discount: { kind: "percent" | "amount"; value: string; label: string } | null;
  shipping: { kind: "rate" | "free" | "custom"; price: string | null };
  lines: {
    id: string;
    kind: "goods" | "custom";
    variantId: string | null;
    title: string;
    sku: string;
    quantity: number;
    unitPriceMinor: number;
    listPriceMinor: number | null;
    customPrice: boolean;
    vatCategory: string | null;
  }[];
};

export const EMPTY_ADDRESS: EditorAddress = { name: "", line1: "", line2: "", postalCode: "", city: "", country: "" };

const addressOf = (raw: Record<string, string | null>): EditorAddress => ({
  name: raw.name ?? "",
  line1: raw.line1 ?? "",
  line2: raw.line2 ?? "",
  postalCode: raw.postalCode ?? "",
  city: raw.city ?? "",
  country: raw.country ?? "",
});

/** The saved draft as typed text. A catalogue line at its list price has no typed price; one with a price of its own (a custom price) keeps it; a custom item always has one. */
export function formFromDraft(draft: DraftLike): EditorState {
  return {
    marketSlug: draft.marketSlug,
    customerId: draft.customerId,
    email: draft.email ?? "",
    phone: draft.phone ?? "",
    shippingAddress: addressOf(draft.shippingAddress),
    billingAddress: addressOf(draft.billingAddress),
    companyName: draft.companyName ?? "",
    organisationNumber: draft.organisationNumber ?? "",
    noteToBuyer: draft.noteToBuyer ?? "",
    internalNote: draft.internalNote ?? "",
    tags: [...draft.tags],
    discount: draft.discount ? { ...draft.discount } : null,
    shipping: { kind: draft.shipping.kind, price: draft.shipping.price ?? "" },
    lines: draft.lines.map((line) => ({
      key: line.id,
      kind: line.kind,
      variantId: line.variantId,
      title: line.title,
      sku: line.sku,
      quantity: line.quantity,
      price: line.kind === "custom" || line.customPrice ? formatPriceInput(line.unitPriceMinor, draft.currency) : "",
      vatCategory: line.vatCategory ?? "",
      listPrice: line.listPriceMinor === null ? null : formatPriceInput(line.listPriceMinor, draft.currency),
    })),
  };
}

let counter = 0;
/** A key for a line made in the browser. */
export const newLineKey = (): string => `new-${(counter += 1)}-${Math.random().toString(36).slice(2, 8)}`;

export function customLine(vatCategory: string): EditorLine {
  return { key: newLineKey(), kind: "custom", variantId: null, title: "", sku: "CUSTOM", quantity: 1, price: "", vatCategory, listPrice: null };
}

export function goodsLine(choice: { variantId: string; productTitle: string; options: string; sku: string; listPriceText: string }): EditorLine {
  const title = choice.options && choice.options !== "Default" ? `${choice.productTitle} (${choice.options})` : choice.productTitle;
  return { key: newLineKey(), kind: "goods", variantId: choice.variantId, title, sku: choice.sku, quantity: 1, price: "", vatCategory: "", listPrice: choice.listPriceText };
}

/** Adds a catalogue variant: one already on the draft gets one more unit instead of a second line. */
export function addGoods(lines: readonly EditorLine[], line: EditorLine, max: number): EditorLine[] {
  const same = lines.find((l) => l.kind === "goods" && l.variantId === line.variantId && l.price === "");
  if (!same) return [...lines, line];
  return lines.map((l) => (l === same ? { ...l, quantity: Math.min(max, l.quantity + 1) } : l));
}

/** Moves a line one place; the lines keep their order in the order, so this is what the buyer reads. */
export function moveLine<T>(lines: readonly T[], index: number, by: -1 | 1): T[] {
  const to = index + by;
  if (index < 0 || index >= lines.length || to < 0 || to >= lines.length) return [...lines];
  const next = [...lines];
  [next[index], next[to]] = [next[to], next[index]];
  return next;
}

/** Whether the draft has a line that is shipped (a catalogue line): only then is there a shipping choice. */
export const shipsGoods = (lines: readonly Pick<EditorLine, "kind">[]): boolean => lines.some((l) => l.kind === "goods");

/** The `draftInput` of the editor's state (the server validates it again). The saved version is the one the editor loaded. */
export function inputFromForm(state: EditorState, version: number): Record<string, unknown> {
  return {
    version,
    marketSlug: state.marketSlug,
    customerId: state.customerId,
    email: state.email,
    phone: state.phone,
    shippingAddress: state.shippingAddress,
    billingAddress: state.billingAddress,
    companyName: state.companyName,
    organisationNumber: state.organisationNumber,
    noteToBuyer: state.noteToBuyer,
    internalNote: state.internalNote,
    tags: state.tags,
    discount: state.discount && state.discount.value.trim() !== "" ? { kind: state.discount.kind, value: state.discount.value, label: state.discount.label } : null,
    // With nothing to ship the shipping choice is the market's rate and costs nothing: it is not sent as a price nobody sees.
    shipping: shipsGoods(state.lines) ? (state.shipping.kind === "custom" ? { kind: "custom", price: state.shipping.price } : { kind: state.shipping.kind }) : { kind: "rate" },
    lines: state.lines.map((line) => ({
      id: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(line.key) ? line.key : null,
      kind: line.kind,
      variantId: line.kind === "goods" ? line.variantId : null,
      title: line.kind === "custom" ? line.title : "",
      quantity: line.quantity,
      price: line.price.trim() === "" ? null : line.price,
      vatCategory: line.kind === "custom" ? line.vatCategory || null : null,
    })),
  };
}

/** A stable text of the editor's state for "is there anything unsaved": the input without its version. */
export const fingerprint = (state: EditorState): string => JSON.stringify(inputFromForm(state, 1));

export const formatDiscountValue = (bps: number): string => formatPercentBps(bps);

/** What a typed tag text becomes: split on commas, trimmed, empty ones dropped (the server validates each). */
export function splitTags(text: string): string[] {
  return text
    .split(",")
    .map((t) => t.trim())
    .filter((t) => t !== "");
}

/** Adds typed tags to the list: a tag that is there already (any case) is not added twice. */
export function addTags(tags: readonly string[], text: string): string[] {
  const next = [...tags];
  for (const tag of splitTags(text)) if (!next.some((t) => t.toLowerCase() === tag.toLowerCase())) next.push(tag);
  return next;
}
