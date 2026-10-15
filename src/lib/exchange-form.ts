import { EXCHANGE_LINES_MAX, EXCHANGE_QUANTITY_MAX } from "./exchange-limits";
import { formatPriceInput, parsePrice } from "./product-input";

/**
 * What the exchange builder on a return's page holds (wave 3, D239, `docs/wave-3-exchanges.md` 2.2), and the input it sends the server. Pure: the browser never prices
 * anything (the summary is `previewExchange()`'s); this only turns what was typed into the builder's input and names what is not filled in yet.
 */

export type BuilderLine = {
  variantId: string;
  title: string;
  sku: string;
  options: string;
  /** The price as the shop shows it in the order's market (the most it may be). */
  listPriceMinor: number;
  quantity: string;
  /** Empty: the list price. A lower price is a product discount. */
  price: string;
};

export type BuilderAddress = { name: string; street: string; postalCode: string; city: string; country: string; phone: string };

export type BuilderForm = {
  lines: BuilderLine[];
  shipping: "free" | "standard" | "set";
  shippingPrice: string;
  address: BuilderAddress;
};

export type BuilderInput = {
  raw: {
    lines: { variantId: string; quantity: number; unitPriceMinor: number }[];
    shipping: { kind: "free" } | { kind: "standard" } | { kind: "set"; amountMinor: number };
    deliveryAddress: { name: string; street: string; postalCode: string; city: string; country: string; phone: string | null };
  };
  /** What stops the input being sent, in words; empty when it can be. */
  problems: string[];
};

export const emptyAddress = (): BuilderAddress => ({ name: "", street: "", postalCode: "", city: "", country: "", phone: "" });

/** The builder's input from what is on the screen, with the problems the server would refuse before pricing. */
export function builderInput(form: BuilderForm, currency: string): BuilderInput {
  const problems: string[] = [];
  if (form.lines.length === 0) problems.push("Add at least one replacement.");
  if (form.lines.length > EXCHANGE_LINES_MAX) problems.push(`An exchange holds at most ${EXCHANGE_LINES_MAX} replacements.`);
  const lines = form.lines.map((line) => {
    const quantity = /^\d{1,3}$/.test(line.quantity.trim()) ? Number(line.quantity.trim()) : Number.NaN;
    if (!(quantity >= 1 && quantity <= EXCHANGE_QUANTITY_MAX)) problems.push(`The quantity of ${line.title} is a whole number from 1 to ${EXCHANGE_QUANTITY_MAX}.`);
    const typed = line.price.trim();
    const price = typed === "" ? line.listPriceMinor : parsePrice(typed, currency);
    if (price === null) problems.push(`"${typed}" is not an amount in ${currency}.`);
    else if (price > line.listPriceMinor) problems.push(`The price of ${line.title} can be lowered, never raised above ${formatPriceInput(line.listPriceMinor, currency)}.`);
    return { variantId: line.variantId, quantity: Number.isFinite(quantity) ? quantity : 0, unitPriceMinor: price ?? 0 };
  });
  let shipping: BuilderInput["raw"]["shipping"] = { kind: form.shipping === "standard" ? "standard" : "free" };
  if (form.shipping === "set") {
    const amount = parsePrice(form.shippingPrice.trim(), currency);
    if (amount === null) problems.push("Type the shipping price, VAT included.");
    shipping = { kind: "set", amountMinor: amount ?? 0 };
  }
  const a = form.address;
  if (![a.name, a.street, a.postalCode, a.city].every((v) => v.trim() !== "") || !/^[A-Za-z]{2}$/.test(a.country.trim())) {
    problems.push("Fill in the delivery address: name, street, postal code, city and the two-letter country.");
  }
  return {
    raw: {
      lines,
      shipping,
      deliveryAddress: {
        name: a.name.trim(),
        street: a.street.trim(),
        postalCode: a.postalCode.trim(),
        city: a.city.trim(),
        country: a.country.trim().toUpperCase(),
        phone: a.phone.trim() || null,
      },
    },
    problems,
  };
}
