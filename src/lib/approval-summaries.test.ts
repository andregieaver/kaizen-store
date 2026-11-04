import { describe, expect, it } from "vitest";

import { inputSummary, listWords, ownWordsSummary, plainText, withInputWords } from "./approval-summaries";
import { MANAGER_TOOLS, PLATFORM_TOOLS } from "./manager-tools";
import { isReadOnly } from "./mcp-catalogue";
import { approvalSummary, OWNER_TOOLS, readToolInput, toolDefinition, type OwnerTool } from "./owner-tools";

/**
 * What a call kept for the person's yes says on its card (D439, 4 November 2026): every tool that can be kept, an owner tool an outside
 * assistant proposes under *Read and propose changes* (any that is not read-only), a gated owner tool, the AI manager's gated tools and
 * the platform's, says what it will do with its subject and values, never only `Run {tool}.`, and none throws on an input it was not given.
 */

/** Every tool whose call can wait for a yes, with where it is offered (the platform's site tools share names with the store's). */
const KEPT: { from: "owner" | "manager" | "platform"; tool: OwnerTool }[] = [
  ...OWNER_TOOLS.filter((t) => t.gate || !isReadOnly(t)).map((tool) => ({ from: "owner" as const, tool })),
  ...MANAGER_TOOLS.filter((t) => t.gate).map((tool) => ({ from: "manager" as const, tool })),
  ...PLATFORM_TOOLS.filter((t) => t.gate).map((tool) => ({ from: "platform" as const, tool })),
];

type Schema = {
  type?: string | string[];
  properties?: Record<string, Schema>;
  additionalProperties?: Schema | boolean;
  items?: Schema;
  anyOf?: Schema[];
  oneOf?: Schema[];
  enum?: unknown[];
  const?: unknown;
  default?: unknown;
  format?: string;
  pattern?: string;
  minLength?: number;
  maxLength?: number;
  minimum?: number;
  exclusiveMinimum?: number;
  maximum?: number;
  multipleOf?: number;
  minItems?: number;
  propertyNames?: Schema;
};

/** What a person would give a field of this name. */
const WORDS: Record<string, string> = {
  order: "1042",
  orders: "1042",
  note: "Customer asked for gift wrap.",
  email: "ann@example.com",
  to: "ann@example.com",
  customer: "ann@example.com",
  person: "ann@example.com",
  sku: "MUG-1",
  product: "linen-shirt",
  other_product: "linen-trousers",
  title: "Autumn news",
  name: "Autumn news",
  domain: "example.com",
  slug: "kaffebrenneriet",
  country: "NO",
  currency: "NOK",
  language: "en",
  market: "no",
  amount: "250",
  percent: "10",
  price: "449",
  code: "AUTUMN10",
  reason: "The customer changed their mind.",
  message: "Thank you for your order: it leaves us tomorrow.",
  subject: "Your order",
  summary: "The invoice page shows the wrong VAT number.",
  carrier: "posten",
  tracking_number: "70701234567890",
  tag: "vip",
  page: "about-us",
  menu: "Main menu",
  category: "Shirts",
  location: "Lager Oslo",
  from: "Lager Oslo",
  value: "google-site-verification=abc123",
  url: "https://example.com/media/shirt.png",
  brief: "Our autumn collection is here: warm linen and wool.",
  purpose: "Tells visitors who we are and how we work.",
  topic: "Which service to offer first",
  finding: "Demand for bookkeeping help is growing among small shops in Norway.",
  description: "A coffee roastery in Oslo selling beans and brewing gear.",
  assignment: "Website",
  start: "2026-11-02",
  end: "2026-11-30",
  date: "2026-11-02",
  at: "2026-11-30 09:00",
  ends_on: "2026-11-30",
  starts_on: "2026-11-01",
  valid_from: "2026-11-01",
  paid_on: "2026-11-02",
  accent: "#1a6b4c",
  text: "Kaffebrenneriet",
  find: "colour",
  replace: "color",
  key: "title",
  role: "staff",
  plan: "growth",
  trigger: "order.paid",
  report: "Weekly sales",
};

/** Texts tried, in order, against a field's pattern. */
const PATTERNED = ["2026-11-30", "2026-11-30 09:00", "09:00", "#1a6b4c", "no", "NO", "NOK", "standard", "7038010069307", "kaffebrenneriet", "/collections/shoes", "a1"];
const UUID = "3f6c2b9e-5d1a-4f0e-9a7b-2c8d4e6f1a3b";

function fitted(text: string, s: Schema): string {
  let out = text;
  while (out.length < (s.minLength ?? 0)) out = `${out} ${text}`;
  return s.maxLength === undefined ? out : out.slice(0, s.maxLength).trim();
}

function stringFor(key: string, s: Schema): string {
  if (s.format === "email") return "ann@example.com";
  if (s.format === "uuid") return UUID;
  if (s.format === "date") return "2026-11-30";
  if (s.pattern) {
    const re = new RegExp(s.pattern);
    if (Object.hasOwn(WORDS, key) && re.test(WORDS[key])) return WORDS[key];
    return PATTERNED.find((p) => re.test(p)) ?? "a1";
  }
  return fitted(Object.hasOwn(WORDS, key) ? WORDS[key] : `Example ${key.replace(/_/g, " ")}`, s);
}

/** A realistic value for a field, from its JSON Schema: every field filled, lists with one or two items. */
function sample(s: Schema, key: string): unknown {
  if (s.const !== undefined) return s.const;
  if (s.enum) return s.enum.find((v) => v !== null) ?? s.enum[0];
  const alternatives = s.anyOf ?? s.oneOf;
  if (alternatives) return sample(alternatives.find((a) => a.type !== "null") ?? alternatives[0], key);
  const type = Array.isArray(s.type) ? s.type.find((t) => t !== "null") : s.type;
  switch (type) {
    case "object": {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(s.properties ?? {})) if (!k.startsWith("approved_")) out[k] = sample(v, k);
      if (typeof s.additionalProperties === "object") {
        const names = s.propertyNames ?? {};
        const name = names.enum ? String(names.enum[0]) : names.pattern ? (PATTERNED.find((p) => new RegExp(names.pattern!).test(p)) ?? "a1") : key === "prices" ? "NO" : "Size";
        out[name] = sample(s.additionalProperties, key === "prices" ? "price" : "value");
      }
      return out;
    }
    case "array":
      return Array.from({ length: Math.max(1, Math.min(2, s.minItems ?? 1)) }, () => sample(s.items ?? {}, key.replace(/s$/, "")));
    case "string":
      return stringFor(key, s);
    case "integer":
    case "number": {
      let n = s.minimum ?? (s.exclusiveMinimum !== undefined ? s.exclusiveMinimum + 1 : 2);
      if (s.multipleOf) n = Math.ceil(n / s.multipleOf) * s.multipleOf;
      return s.maximum !== undefined ? Math.min(n, s.maximum) : n;
    }
    case "boolean":
      return typeof s.default === "boolean" ? s.default : true;
    default:
      return s.default;
  }
}

/** Inputs written by hand where a schema alone does not make one that reads (rules beyond the shape), or to read closer to life. */
const BY_HAND: Record<string, Record<string, unknown>> = {
  add_order_note: { order: "1042", note: "Customer asked for gift wrap." },
  tag_orders: { orders: ["1042", "1043"], add: ["vip", "gift-wrap"], remove: ["rush"] },
  create_draft_order: { email: "ann@example.com", lines: [{ sku: "MUG-1", quantity: 2 }], market: "no" },
  add_redirect: { from: "/collections/shoes", to: "/p/shoes" },
  save_segment: { name: "Big spenders", rules: { match: "all", conditions: [{ kind: "orders", op: "atLeast", value: 2 }] } },
  count_segment: { rules: { match: "all", conditions: [] } },
  draft_workflow: { name: "Tag big orders", trigger: "order.paid", actions: [{ kind: "tag_order", tag: "big" }] },
  create_product: { title: "Linen shirt", prices: { NO: "499", SE: "549" }, stock: 10, options: [{ name: "Size", values: ["S", "M", "L"] }], categories: ["Shirts"], tags: ["linen"] },
  update_product: { product: "linen-shirt", title: "Linen shirt, washed" },
  set_prices: { product: "linen-shirt", changes: [{ sku: "LINEN-M", prices: { NO: "549" } }] },
  set_product_status: { product: "linen-shirt", status: "active" },
  delete_search_merchandising: { rule: UUID },
  set_currencies: { add: [{ currency: "EUR", rate: 11.6, round_to: 0.5 }], remove: ["SEK"] },
  make_theme_live: { install: UUID },
};

function realistic(entry: (typeof KEPT)[number]): { ok: true; input: Record<string, unknown> } | { ok: false; problem: string } {
  const own = entry.from === "owner" && Object.hasOwn(BY_HAND, entry.tool.name) ? BY_HAND[entry.tool.name] : null;
  const raw = own ?? sample(toolDefinition(entry.tool).parameters as Schema, "input");
  const read = readToolInput(entry.tool, raw);
  return read.ok ? { ok: true, input: read.input as Record<string, unknown> } : { ok: false, problem: `${read.problem} in ${JSON.stringify(raw).slice(0, 400)}` };
}

describe("a kept call's card (D439)", () => {
  it("covers every tool that can wait for a yes", () => {
    expect(KEPT.length).toBeGreaterThan(120);
    for (const name of ["add_order_note", "tag_orders", "create_product", "tag_customer", "change_dns", "contact_kaizen_support", "start_autopilot_plan", "approve_access_request"]) {
      expect(KEPT.some((k) => k.tool.name === name), name).toBe(true);
    }
  });

  it.each(KEPT.map((k) => [`${k.from} ${k.tool.name}`, k] as const))("%s says what it will do, from a realistic input", (_label, entry) => {
    const input = realistic(entry);
    if (!input.ok) throw new Error(`no realistic input for ${entry.tool.name}: ${input.problem}`);
    const words = approvalSummary(entry.tool.name, input.input);
    expect(words).not.toBe(`Run ${entry.tool.name}.`);
    expect(words).not.toMatch(/^Run [a-z_]+\.$/);
    if (entry.tool.name.includes("_")) expect(words).not.toContain(entry.tool.name);
    expect(words).not.toMatch(/undefined|NaN|\[object Object\]|\{"|function |\bnull\b/);
    expect(words.trim().length).toBeGreaterThan(10);
    expect(words.length).toBeLessThan(2500);
  });

  it.each(KEPT.map((k) => [`${k.from} ${k.tool.name}`, k] as const))("%s never throws on an empty input", (_label, entry) => {
    let words = "";
    expect(() => (words = approvalSummary(entry.tool.name, {}))).not.toThrow();
    expect(words).not.toBe(`Run ${entry.tool.name}.`);
    expect(words.trim()).not.toBe("");
  });
});

describe("the words of the tools that had none", () => {
  it("say an order's note in full, with its order, as the card before said only Run add_order_note", () => {
    expect(approvalSummary("add_order_note", { order: "1042", note: "Customer asked for gift wrap." })).toBe('Add a note to order 1042, for the store\'s staff only: "Customer asked for gift wrap."');
  });

  it("say which tags go on and off which orders, and what archiving does", () => {
    expect(approvalSummary("tag_orders", { orders: ["1042", "1043"], add: ["vip", "gift-wrap"], remove: ["rush"] })).toBe(
      'Put the tags "vip" and "gift-wrap" on orders 1042 and 1043, and take the tag "rush" off them.',
    );
    expect(approvalSummary("tag_orders", { orders: ["1042"], add: [], remove: ["rush"] })).toBe('Take the tag "rush" off order 1042.');
    expect(approvalSummary("archive_orders", { orders: ["1042"], archived: true })).toBe("Archive order 1042: it leaves the default list and the queues, and nothing is deleted.");
    expect(approvalSummary("archive_orders", { orders: ["1042", "1043"], archived: false })).toBe("Bring orders 1042 and 1043 back from the archive.");
  });

  it("say a draft order's customer, goods and discount, and a draft's typed prices", () => {
    expect(
      approvalSummary("create_draft_order", { email: "ann@example.com", lines: [{ sku: "MUG-1", quantity: 2 }, { sku: "CAP", quantity: 1 }], market: "no", discount_percent: "10", discount_label: "Loyal customer" }),
    ).toBe('Write a draft order for ann@example.com: 2 × MUG-1 and 1 × CAP, in the market no, 10 % off called "Loyal customer". Nothing is sent yet.');
    expect(approvalSummary("set_draft_prices", { draft: "D-12", lines: [{ sku: "OAK-TABLE", price: "4990" }, { sku: "LAMP", price: "" }] })).toBe(
      "On draft order D-12: OAK-TABLE at 4990 and LAMP without a typed price (for one, VAT included, in the draft's currency). Nothing is sent.",
    );
  });

  it("say a new product's title and what it is given, and a customer's tag", () => {
    expect(approvalSummary("create_product", BY_HAND.create_product)).toBe(
      'Make the product "Linen shirt" as a draft, not on the site: price 499 in NO and 549 in SE; options Size (S, M and L); 10 in stock; categories "Shirts"; tags "linen".',
    );
    expect(approvalSummary("tag_customer", { email: "ann@example.com", tag: "vip", remove: false })).toBe('Put the tag "vip" on the customer ann@example.com.');
    expect(approvalSummary("tag_customer", { email: "ann@example.com", tag: "vip", remove: true })).toBe('Take the tag "vip" off the customer ann@example.com.');
  });

  it("say stock moved, time logged, a target and a DNS change with their values", () => {
    expect(approvalSummary("create_transfer", { from: "Lager Oslo", to: "Butikken", lines: [{ sku: "MUG-1", quantity: 5 }] })).toBe(
      'Make a draft transfer of stock from "Lager Oslo" to "Butikken": 5 × MUG-1. Nothing moves until it is sent on its page.',
    );
    expect(approvalSummary("log_time", { assignment: "Website", minutes: 90, billable: true, note: "Fixed the menu" })).toBe(
      'Log 1 h 30 min on the Work assignment "Website" for today: "Fixed the menu"',
    );
    expect(approvalSummary("set_target", { metric: "net_sales", period: "month", start: "2026-11-01", value: "50000" })).toBe(
      'Set the target for net sales for the month of 2026-11-01: "50000". Shoppers see nothing of it.',
    );
    expect(approvalSummary("change_dns", { domain: "example.com", add: [{ type: "A", name: "www", value: "76.76.21.21" }], remove: [] })).toBe(
      'Change the DNS of example.com: add A www "76.76.21.21".',
    );
  });

  it("say a page's draft changes one by one", () => {
    expect(
      approvalSummary("edit_page", {
        page: "about-us",
        type: "page",
        changes: [
          { do: "set_text", key: "title", text: "About us" },
          { do: "replace", find: "colour", replace: "color" },
        ],
      }),
    ).toBe('Change the draft of the page "about-us": the text title to "About us" and "colour" replaced with "color" everywhere. Visitors see nothing until it is published.');
  });

  it("are null for a tool with its own words elsewhere", () => {
    expect(ownWordsSummary("refund_order", { order: "1042" })).toBeNull();
    expect(ownWordsSummary("constructor", {})).toBeNull();
  });

  it("never print a function for a name found on an object's prototype", () => {
    expect(approvalSummary("set_up_email", { domain: "example.com", provider: "constructor" })).not.toMatch(/function|native code/);
    expect(approvalSummary("set_target", { metric: "toString", period: "month", start: "2026-11-01", value: "1" })).not.toMatch(/function|native code/);
  });
});

describe("a tool with no words of its own (D439)", () => {
  it("is named by its title and its input's fields in plain words", () => {
    expect(inputSummary("archive_supplier", { supplier: "Fjord Linen", notify: false, valid_days: 7 })).toBe('Archive supplier: supplier "Fjord Linen"; notify no; valid days 7.');
    expect(approvalSummary("archive_supplier", { supplier: "Fjord Linen" })).toBe('Archive supplier: supplier "Fjord Linen"');
    expect(inputSummary("archive_supplier", {})).toBe("Archive supplier.");
  });

  it("writes an app's tool's arguments the same way, and names one whose app is gone by its words", () => {
    expect(withInputWords("Ask Warehouse to run book_pickup", { sku: "MUG-1", quantity: 2 })).toBe('Ask Warehouse to run book_pickup: sku "MUG-1"; quantity 2.');
    expect(withInputWords("Ask Warehouse to run book_pickup", {})).toBe("Ask Warehouse to run book_pickup.");
    expect(approvalSummary("app__warehouse__book_pickup", { sku: "MUG-1" })).toBe('App warehouse book pickup: sku "MUG-1"');
  });

  it("writes lists and objects in words, never as JSON", () => {
    const words = inputSummary("ship_parcels", { parcels: [{ sku: "MUG-1", quantity: 2 }, { sku: "CAP", quantity: 1 }], options: { insured: true, carrier: "posten" }, approved_base: { v: 3 } });
    expect(words).toBe('Ship parcels: parcels (sku "MUG-1", quantity 2), (sku "CAP", quantity 1); options (insured yes, carrier "posten").');
    expect(words).not.toContain("approved");
  });

  it("is bounded, on one line, without control or invisible characters, and leaves markup as text", () => {
    const long = inputSummary("send_note", { note: "a".repeat(5000), more: Array.from({ length: 50 }, (_, i) => `item ${i}`), deep: { a: { b: { c: { d: "deep" } } } } });
    expect(long.length).toBeLessThanOrEqual(720);
    const odd = inputSummary("send_note", { note: "Pay‮evil​ now\n\nplease\t<b>bold</b>" });
    expect(odd).toBe('Send note: note "Pay evil now please <b>bold</b>"');
    expect(odd).not.toMatch(/[‮​\n\t]/);
    expect(inputSummary("send_note", { a: { b: { c: { d: { e: "deep" } } } } })).toBe("Send note: a (b (c (d …))).");
  });

  it("writes a text on one line and lists as a person does", () => {
    expect(plainText("  two\n\nlines  ")).toBe("two lines");
    expect(plainText("abcdef", 4)).toBe("abc…");
    expect(listWords(["a"])).toBe("a");
    expect(listWords(["a", "b", "c"])).toBe("a, b and c");
    expect(listWords(["a", "b", "c"], 2)).toBe("a, b and 1 more");
  });
});
