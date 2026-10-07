/**
 * The order editor's own state and how it becomes the input the server checks (wave 3, run 3, D174, `docs/wave-3-fulfilment.md` 2.2): the new quantities as typed
 * (only the lines that changed are sent), the products added (a price only when staff typed one: empty is the market's list price as shown), the shipping, the reason,
 * the note and the switches. Pure and shared with the browser: no zod here (the server reads the result through `orderEditInput`), and nothing is priced: the
 * summary is always the server's.
 */
import { parsePrice } from "./product-input";
import type { OrderEditReason } from "./order-edit-status";

/** A line of the order as the editor shows it. Only goods (`editable`) can be lowered or taken off. */
export type EditorOrderLine = {
  lineId: string;
  variantId: string | null;
  title: string;
  sku: string;
  quantity: number;
  unitPriceMinor: number;
  totalMinor: number;
  editable: boolean;
  /** A free product from a campaign (D114): it may be taken off, and is never taken off by itself. */
  gift: boolean;
};

/** A product added on the screen. `price` is the custom price as typed ("" = the list price as shown). */
export type EditorAdded = { variantId: string; title: string; sku: string; options: string; listPriceMinor: number; quantity: string; price: string };

export type EditFormState = {
  /** The quantity of each line as typed, by line id. */
  quantities: Record<string, string>;
  added: EditorAdded[];
  shipping: { kind: "keep" } | { kind: "set"; amount: string };
  restock: boolean;
  /** Variants whose units taken off are not put back (damaged goods). */
  noRestock: string[];
  reason: OrderEditReason | "";
  note: string;
  notify: boolean;
};

export function initialEditForm(lines: readonly EditorOrderLine[]): EditFormState {
  return {
    quantities: Object.fromEntries(lines.map((l) => [l.lineId, String(l.quantity)])),
    added: [],
    shipping: { kind: "keep" },
    restock: true,
    noRestock: [],
    reason: "",
    note: "",
    notify: true,
  };
}

/** The input the server's `orderEditInput` reads, and the problems found before asking it (a quantity or price that is not a number, no reason yet). */
export type EditFormInput = {
  raw: {
    quantities: Record<string, number>;
    added: { variantId: string; quantity: number; unitPriceMinor?: number }[];
    shipping: { kind: "keep" } | { kind: "set"; amountMinor: number };
    reason: OrderEditReason;
    note?: string;
    notify: boolean;
    restock: boolean;
    noRestock: string[];
  };
  /** Problems of the form itself, in words; a form with any is not previewed. */
  problems: string[];
  /** No reason was chosen yet: the preview reads the change as *Other*, and nothing can be saved or sent until one is. */
  reasonMissing: boolean;
};

const WHOLE = /^\d{1,4}$/;

export function editInputFromForm(state: EditFormState, lines: readonly EditorOrderLine[], currency: string): EditFormInput {
  const problems: string[] = [];
  const quantities: Record<string, number> = {};
  for (const line of lines) {
    if (!line.editable) continue;
    const typed = (state.quantities[line.lineId] ?? String(line.quantity)).trim();
    if (!WHOLE.test(typed)) {
      problems.push(`The quantity of ${line.title} is not a whole number.`);
      continue;
    }
    const value = Number(typed);
    if (value !== line.quantity) quantities[line.lineId] = value;
  }
  const added = state.added.map((a) => {
    const typedQuantity = a.quantity.trim();
    if (!WHOLE.test(typedQuantity) || Number(typedQuantity) < 1) problems.push(`The quantity of ${a.title} is not a whole number from 1 to 9,999.`);
    const price = a.price.trim();
    let unitPriceMinor: number | undefined;
    if (price !== "") {
      const parsed = parsePrice(price, currency);
      if (parsed === null) problems.push(`"${price}" is not a price in ${currency}.`);
      else unitPriceMinor = parsed;
    }
    return { variantId: a.variantId, quantity: Number(typedQuantity) || 0, ...(unitPriceMinor !== undefined ? { unitPriceMinor } : {}) };
  });
  let shipping: EditFormInput["raw"]["shipping"] = { kind: "keep" };
  if (state.shipping.kind === "set") {
    const parsed = parsePrice(state.shipping.amount.trim() === "" ? "0" : state.shipping.amount, currency);
    if (parsed === null) problems.push(`"${state.shipping.amount}" is not a shipping price in ${currency}.`);
    else shipping = { kind: "set", amountMinor: parsed };
  }
  const note = state.note.trim();
  return {
    raw: {
      quantities,
      added,
      shipping,
      reason: state.reason === "" ? "other" : state.reason,
      ...(note ? { note } : {}),
      notify: state.notify,
      restock: state.restock,
      noRestock: state.restock ? state.noRestock : [],
    },
    problems,
    reasonMissing: state.reason === "",
  };
}

/** The variants whose units the change takes off (the restock choices), each once, in the order's line order. */
export function variantsTakenOff(state: EditFormState, lines: readonly EditorOrderLine[]): { variantId: string; title: string }[] {
  const out: { variantId: string; title: string }[] = [];
  for (const line of lines) {
    if (!line.editable || !line.variantId) continue;
    const typed = (state.quantities[line.lineId] ?? "").trim();
    if (!WHOLE.test(typed) || Number(typed) >= line.quantity) continue;
    if (!out.some((v) => v.variantId === line.variantId)) out.push({ variantId: line.variantId, title: line.title });
  }
  return out;
}
