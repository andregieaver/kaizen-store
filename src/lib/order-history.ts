/**
 * An order history from another shop (wave 11 unit E, D384), pure: Shopify's order export read into orders that are HISTORY. They become
 * copied orders (`C-…`, `orders.copied_from`, D129), so nothing pays, refunds, ships, emails, invoices or counts them in revenue; they carry
 * the file's amounts in the file's currency as they were.
 *
 * Held to Shopify's order export (help.shopify.com/en/manual/fulfillment/managing-orders/exporting-orders, read 29 October 2026): an order's
 * first row carries Name, Email, Financial Status, Fulfillment Status, Currency, Subtotal, Shipping, Taxes, Total, Discount Code, Discount
 * Amount, Created at, Canceled at and the addresses; each line item is a row of its own (Lineitem quantity, name, price, SKU), the order's
 * other cells blank. What is never read: payment methods and references, card or payment data, notes, phone numbers, tags, risk, staff and
 * device. A customer is named only by the email on the order, which the import ties only to a customer the store already has.
 */
import { parsePrice } from "./product-input";
import { normaliseEmail } from "./email-address";

export const HISTORY_ORDERS_MAX = 20_000;
export const HISTORY_LINES_MAX = 200;

const norm = (name: string) => name.replace(/^﻿/, "").trim().toLowerCase().replace(/\s+/g, " ");

/** Whether a header row is Shopify's order export: its Name, Financial Status and Lineitem quantity. */
export const isShopifyOrders = (header: readonly string[]): boolean => {
  const names = header.map(norm);
  return names.includes("name") && names.includes("financial status") && names.includes("lineitem quantity");
};

export type HistoryAddress = { name: string; line1: string; line2?: string; postalCode: string; city: string; country: string };

export type HistoryLine = { sku: string; title: string; quantity: number; unitPriceMinor: number; totalMinor: number };

export type HistoryOrder = {
  /** The order's name in the old shop (`#1001`), its number here being `C-1001`. */
  name: string;
  rows: number[];
  email: string;
  currency: string;
  /** `fulfilled`, `paid` or `cancelled`, as far as the file says; never a state that waits for anything. */
  status: "paid" | "fulfilled" | "cancelled";
  placedAt: string;
  subtotalMinor: number;
  shippingMinor: number;
  taxMinor: number;
  discountMinor: number;
  totalMinor: number;
  discountCode: string | null;
  billing: HistoryAddress | null;
  shipping: HistoryAddress | null;
  lines: HistoryLine[];
};

export type HistoryProblem = { rows: number[]; order: string | null; problem: "no_name" | "no_email" | "currency" | "amount" | "date" | "no_lines" | "too_many_lines" | "duplicate" };

export const PROBLEM_WORDS: Record<HistoryProblem["problem"], string> = {
  no_name: "A row has line items but no order before it.",
  no_email: "The order has no email address.",
  currency: "The order's currency is not a three-letter code.",
  amount: "An amount of the order could not be read in its currency.",
  date: "The order's Created at is not a date.",
  no_lines: "The order has no line items.",
  too_many_lines: `The order has more than ${HISTORY_LINES_MAX} line items.`,
  duplicate: "The order appears twice in the file.",
};

/** The order's number here: its name without the `#`, after `C-`, letters, digits and hyphens only. */
export function historyNumber(name: string): string {
  const plain = name.replace(/^#/, "").replace(/[^A-Za-z0-9-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
  return `C-${plain || "order"}`;
}

const statusOf = (financial: string, fulfillment: string, canceledAt: string): HistoryOrder["status"] => {
  const f = financial.trim().toLowerCase();
  if (canceledAt.trim() !== "" || f === "voided" || f === "refunded") return "cancelled";
  return fulfillment.trim().toLowerCase() === "fulfilled" ? "fulfilled" : "paid";
};

const address = (cells: Record<string, string>, prefix: "billing" | "shipping"): HistoryAddress | null => {
  const at = (field: string) => (cells[`${prefix} ${field}`] ?? "").trim();
  const line1 = at("address1") || at("street");
  const country = at("country").toUpperCase();
  if (!line1 && !at("city")) return null;
  const out: HistoryAddress = { name: at("name"), line1, postalCode: at("zip"), city: at("city"), country: /^[A-Z]{2}$/.test(country) ? country : "" };
  if (at("address2")) out.line2 = at("address2");
  return out;
};

/** The file's rows (the header first) as orders and what could not be read, each named by its rows; nothing is guessed. */
export function readShopifyOrders(raw: readonly (readonly string[])[]): { orders: HistoryOrder[]; problems: HistoryProblem[] } {
  const names = (raw[0] ?? []).map(norm);
  const orders: HistoryOrder[] = [];
  const problems: HistoryProblem[] = [];
  const seen = new Set<string>();
  let current: (HistoryOrder & { broken: boolean }) | null = null;
  const close = () => {
    if (!current) return;
    if (!current.broken && current.lines.length === 0) problems.push({ rows: current.rows, order: current.name, problem: "no_lines" });
    else if (!current.broken && current.lines.length > HISTORY_LINES_MAX) problems.push({ rows: current.rows, order: current.name, problem: "too_many_lines" });
    else if (!current.broken) {
      const { broken: _broken, ...order } = current;
      void _broken;
      orders.push(order);
    }
    current = null;
  };
  for (let r = 1; r < raw.length; r += 1) {
    const row = raw[r];
    if (row.every((c) => c.trim() === "")) continue;
    const cells: Record<string, string> = {};
    names.forEach((n, i) => {
      if (n !== "" && !Object.hasOwn(cells, n)) cells[n] = row[i] ?? "";
    });
    const name = (cells.name ?? "").trim();
    const fail = (problem: HistoryProblem["problem"]) => {
      if (current) current.broken = true;
      problems.push({ rows: [r + 1], order: name || current?.name || null, problem });
    };
    const startsOrder = name !== "" && (!current || current.name !== name);
    if (startsOrder) {
      close();
      if (seen.has(name)) {
        problems.push({ rows: [r + 1], order: name, problem: "duplicate" });
        current = { ...emptyOrder(name, r + 1), broken: true };
        continue;
      }
      seen.add(name);
      const currency = (cells.currency ?? "").trim().toUpperCase();
      const placed = new Date((cells["created at"] ?? "").trim());
      current = { ...emptyOrder(name, r + 1), broken: false };
      current.email = normaliseEmail(cells.email ?? "");
      if (!current.email) fail("no_email");
      if (!/^[A-Z]{3}$/.test(currency)) {
        fail("currency");
        continue;
      }
      current.currency = currency;
      if (Number.isNaN(placed.getTime())) fail("date");
      else current.placedAt = placed.toISOString();
      const money = (column: string) => {
        const text = (cells[column] ?? "").trim();
        if (text === "") return 0;
        const minor = parsePrice(text.replace(/^-/, ""), currency);
        if (minor === null) {
          fail("amount");
          return 0;
        }
        return minor;
      };
      current.subtotalMinor = money("subtotal");
      current.shippingMinor = money("shipping");
      current.taxMinor = money("taxes");
      current.discountMinor = money("discount amount");
      current.totalMinor = money("total");
      current.discountCode = (cells["discount code"] ?? "").trim() || null;
      current.status = statusOf(cells["financial status"] ?? "", cells["fulfillment status"] ?? "", cells["canceled at"] ?? "");
      current.billing = address(cells, "billing");
      current.shipping = address(cells, "shipping");
    } else if (!current) {
      problems.push({ rows: [r + 1], order: null, problem: "no_name" });
      continue;
    } else {
      current.rows.push(r + 1);
    }
    if (!current || current.broken) continue;
    const quantity = Number((cells["lineitem quantity"] ?? "").trim());
    const title = (cells["lineitem name"] ?? "").trim();
    if (Number.isInteger(quantity) && quantity > 0 && title !== "") {
      const unit = parsePrice((cells["lineitem price"] ?? "").trim() || "0", current.currency);
      if (unit === null) {
        fail("amount");
        continue;
      }
      current.lines.push({ sku: (cells["lineitem sku"] ?? "").trim().slice(0, 64) || "-", title: title.slice(0, 300), quantity, unitPriceMinor: unit, totalMinor: unit * quantity });
    }
  }
  close();
  return { orders, problems };
}

function emptyOrder(name: string, row: number): HistoryOrder {
  return {
    name,
    rows: [row],
    email: "",
    currency: "",
    status: "paid",
    placedAt: "",
    subtotalMinor: 0,
    shippingMinor: 0,
    taxMinor: 0,
    discountMinor: 0,
    totalMinor: 0,
    discountCode: null,
    billing: null,
    shipping: null,
    lines: [],
  };
}
