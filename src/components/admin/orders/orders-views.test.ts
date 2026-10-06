import { createElement as h } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { parseOrderListParams } from "@/lib/order-list";
import { tableRowsOf } from "@/lib/order-list-admin";
import type { OrderListItem } from "@/lib/order-list-row";
import type { BulkResult } from "@/lib/order-bulk";

import { OrderListView } from "./order-list-view";
import { ResultPanel } from "./order-table";
import { ViewTools } from "./view-tools";

const BAD = /\bNaN\b|Infinity|undefined|\[object|\bnull\b/;
const plain = (html: string) =>
  html
    .replace(/<script[\s\S]*?<\/script>/g, "")
    .replace(/<!-- -->/g, "")
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/[  ]/g, " ");

/** The `<input>` of a field with this name and value, to ask whether it is ticked. */
const inputOf = (html: string, name: string, value: string): string => html.match(new RegExp(`<input[^>]*name="${name}"[^>]*value="${value}"[^>]*>`))?.[0] ?? "";

const item = (over: Partial<OrderListItem> = {}): OrderListItem => ({
  id: "11111111-1111-4111-8111-111111111111",
  number: "1001",
  status: "paid",
  placedAt: "2026-10-05T10:30:00.000Z",
  totalMinor: 124900,
  currency: "NOK",
  marketCode: "NO",
  copied: false,
  archived: false,
  source: "checkout",
  draftNumber: null,
  gift: false,
  erased: false,
  email: "kari@example.no",
  name: "Kari Nordmann",
  items: 2,
  owed: 0,
  tags: [{ key: "vip", label: "VIP" }],
  pay: "paid",
  ship: "to_send",
  balanceMinor: 0,
  ...over,
});

const noop = async () => ({ ok: true as const, message: "ok" });
const viewActions = { save: noop, update: noop, remove: noop, reorder: noop };

const draw = (over: Record<string, unknown> = {}, query = "") => {
  const params = parseOrderListParams(new URLSearchParams(query));
  const rows = (over.rows as OrderListItem[] | undefined) ?? [item()];
  const html = renderToString(
    h(OrderListView, {
      slug: "shop",
      params,
      rows: tableRowsOf(rows, { locale: "nb-NO", timeZone: "Europe/Oslo" }),
      count: rows.length,
      capped: false,
      hasPrevious: false,
      previousCursor: null,
      nextCursor: null,
      views: [],
      openView: null,
      ignoredInView: false,
      truncatedSearch: false,
      markets: [{ code: "NO", name: "Norge" }, { code: "SE", name: "Sverige" }],
      tagSuggestions: ["VIP", "wholesale"],
      canWrite: true,
      bulk: async () => ({ ok: false as const, message: "x" }),
      viewActions,
      ...over,
    } as never),
  );
  const text = plain(html);
  expect(text).not.toMatch(BAD);
  return { html, text };
};

describe("the orders list", () => {
  it("lists an order with its number, customer, state, items, tags and total in its own currency", () => {
    const { html, text } = draw();
    expect(html).toContain('href="/admin/shop/orders/11111111-1111-4111-8111-111111111111"');
    expect(text).toContain("#1001");
    expect(text).toContain("Kari Nordmann");
    expect(text).toContain("Paid");
    expect(text).toContain("To send");
    expect(text).toContain("2 items");
    expect(text).toContain("VIP");
    expect(text).toMatch(/1\s?249,00/);
    expect(text).toContain("1 order");
  });

  it("shows the built-in views and the saved ones as links, with the open one marked", () => {
    const id = "22222222-2222-4222-8222-222222222222";
    const { html, text } = draw({ views: [{ id, title: "VIPs to send" }], openView: { id, title: "VIPs to send" } });
    for (const label of ["All", "To send", "Waiting for stock", "Unfinished checkouts", "Archived"]) expect(text).toContain(label);
    expect(html).toContain('href="/admin/shop/orders?show=to-send"');
    expect(html).toContain(`href="/admin/shop/orders?view=${id}"`);
    expect(html).toMatch(new RegExp(`aria-current="page"[^>]*>VIPs to send`));
  });

  it("marks the built-in view that is the whole of the state, and only then", () => {
    expect(draw({}, "show=to-send").html).toMatch(/href="\/admin\/shop\/orders\?show=to-send"[^>]*aria-current="page"|aria-current="page"[^>]*href="\/admin\/shop\/orders\?show=to-send"/);
    const withSearch = draw({}, "show=to-send&q=anna").html;
    expect(withSearch.slice(0, withSearch.indexOf("</nav>"))).not.toContain('aria-current="page"');
  });

  it("shows each filter that is on as a chip that clears it, and the search in its box", () => {
    const { html, text } = draw({}, "q=anna&pay=paid&tag=vip&range=30d&gift=1");
    expect(html).toContain('value="anna"');
    expect(text).toContain("Search: anna");
    expect(text).toContain("Payment: paid");
    expect(text).toContain("Tagged: vip");
    expect(text).toContain("Placed: last 30 days");
    expect(text).toContain("Gifts");
    // Clearing the payment chip keeps the others and drops the cursor and the view.
    expect(html).toContain('href="/admin/shop/orders?q=anna&amp;tag=vip&amp;range=30d&amp;gift=1"');
    expect(html).toContain("Clear all");
  });

  it("fills the filter form from the state, with a built-in view written out as its filters", () => {
    const { html } = draw({}, "show=to-send&pay=paid&sort=total_desc&cols=placed,total");
    expect(inputOf(html, "ship", "to_send")).toContain('checked=""');
    expect(inputOf(html, "ship", "sent")).not.toContain('checked=""');
    expect(inputOf(html, "pay", "paid")).toContain('checked=""');
    expect(html).toContain('<option value="total_desc" selected=""');
    // Columns: the two chosen are ticked, the others are not.
    expect(inputOf(html, "cols", "total")).toContain('checked=""');
    expect(inputOf(html, "cols", "placed")).toContain('checked=""');
    expect(inputOf(html, "cols", "tags")).not.toContain('checked=""');
  });

  it("is a plain GET form, so the address is the state", () => {
    const { html } = draw();
    expect(html).toContain('method="get"');
    expect(html).toContain('action="/admin/shop/orders"');
    expect(html).toContain('name="q"');
    expect(html).toContain('maxLength="100"');
  });

  it("badges archived, gift, staff-made, waiting, copied and erased orders without drawing the person of an erased one", () => {
    const rows = [
      item({ id: "a0000000-0000-4000-8000-000000000001", number: "2001", archived: true, gift: true }),
      item({ id: "a0000000-0000-4000-8000-000000000002", number: "2002", source: "draft", draftNumber: "D-12", owed: 3 }),
      item({ id: "a0000000-0000-4000-8000-000000000003", number: "C-3", copied: true, pay: "copied", ship: "copied" }),
      item({ id: "a0000000-0000-4000-8000-000000000004", number: "2004", erased: true, email: null, name: null }),
    ];
    const { text } = draw({ rows });
    expect(text).toContain("Archived");
    expect(text).toContain("Gift");
    expect(text).toContain("Staff-made D-12");
    expect(text).toContain("Waiting for stock");
    expect(text).toContain("3 units owed");
    expect(text).toContain("Copied");
    expect(text).toContain("Personal data erased");
    expect(text).toContain("Erased");
  });

  it("hides the columns that are not chosen and keeps the order number first", () => {
    const { text, html } = draw({}, "cols=total");
    const header = html.slice(html.indexOf("<thead>"), html.indexOf("</thead>"));
    expect(header).not.toContain(">Customer<");
    expect(header).not.toContain(">Payment<");
    expect(header.indexOf(">Order<")).toBeLessThan(header.indexOf(">Total<"));
    expect(text).toMatch(/1\s?249,00/);
  });

  it("offers the selection and the views to someone who may change orders, and neither to someone who may not", () => {
    const writer = draw();
    expect(writer.html).toContain('aria-label="Select all orders on this page"');
    expect(writer.html).toContain('aria-label="Select order 1001"');
    expect(writer.text).toContain("Save this list as a view");
    const reader = draw({ canWrite: false, viewActions: null });
    expect(reader.html).not.toContain('aria-label="Select all orders on this page"');
    expect(reader.text).not.toContain("Save this list as a view");
    // They can still search, filter and open a view.
    expect(reader.html).toContain('role="search"');
  });

  it("pages by a cursor, with a way back, and says how many match", () => {
    const next = draw({ nextCursor: "abc", hasPrevious: true, previousCursor: "xyz", count: 120 }, "q=anna");
    expect(next.html).toContain('href="/admin/shop/orders?q=anna&amp;after=abc"');
    expect(next.html).toContain('href="/admin/shop/orders?q=anna&amp;after=xyz"');
    expect(next.text).toContain("Next 50 orders");
    expect(next.text).toContain("Previous 50 orders");
    expect(next.text).toContain("120 orders");
    const back = draw({ hasPrevious: true, previousCursor: null });
    expect(back.text).toContain("Back to the first page");
    const capped = draw({ count: 10000, capped: true });
    expect(capped.text).toContain("10,000+ orders");
  });

  it("says what an empty list means and how to clear it", () => {
    const search = draw({ rows: [], count: 0 }, "q=zzz");
    expect(search.text).toContain("No order matches “zzz”");
    expect(search.html).toContain('href="/admin/shop/orders"');
    expect(draw({ rows: [], count: 0 }, "show=to-send").text).toContain("Nothing to send");
    expect(draw({ rows: [], count: 0 }, "show=unpaid").text).toContain("No unfinished checkouts");
    expect(draw({ rows: [], count: 0 }, "show=archived").text).toContain("No archived orders");
    expect(draw({ rows: [], count: 0 }, "pay=refunded").text).toContain("No order matches these filters");
    const none = draw({ rows: [], count: 0 });
    expect(none.text).toContain("No orders yet");
    expect(none.html).toContain('href="/admin/shop/orders/drafts/new"');
  });

  it("tells when a saved view no longer applies fully and when a search was cut", () => {
    const id = "22222222-2222-4222-8222-222222222222";
    const { text } = draw({ openView: { id, title: "Old" }, ignoredInView: true, truncatedSearch: true, views: [{ id, title: "Old" }] });
    expect(text).toContain("settings no longer apply");
    expect(text).toContain("Only the first 5 words of the search are used.");
  });

  it("offers the markets only when the store has more than one", () => {
    expect(draw().html).toContain('name="market"');
    expect(draw({ markets: [{ code: "NO", name: "Norge" }] }).html).not.toContain('name="market"');
  });

  it("keeps free text as text", () => {
    const { html } = draw({ rows: [item({ name: "<img src=x onerror=alert(1)>", tags: [{ key: "x", label: "<b>x</b>" }] })] });
    expect(html).not.toContain("<img src=x");
    expect(html).not.toContain("<b>x</b>");
    expect(html).toContain("&lt;b&gt;x&lt;/b&gt;");
  });
});

describe("the bulk result", () => {
  const result = (over: Partial<BulkResult> = {}): BulkResult => ({
    action: "archive",
    requested: 43,
    applied: 41,
    refused: [
      { id: "a", number: "1007", reason: "needs_sending" },
      { id: "b", number: "1009", reason: "needs_sending" },
    ],
    ...over,
  });

  it("says how many it applied to and lists each refusal with its reason", () => {
    const text = plain(renderToString(h(ResultPanel, { result: result() })));
    expect(text).toContain("Applied to 41 of 43 orders");
    expect(text).toContain("2 orders not changed:");
    expect(text).toContain("It is paid and still has to be sent.");
    expect(text).toContain("#1007, #1009");
  });

  it("never names an order that was not this store's", () => {
    const text = plain(renderToString(h(ResultPanel, { result: result({ refused: [{ id: "zzz", number: null, reason: "not_found" }] }) })));
    expect(text).toContain("an order that was not found");
    expect(text).not.toContain("zzz");
  });

  it("says how many customers were emailed when the send told them", () => {
    expect(plain(renderToString(h(ResultPanel, { result: result({ action: "mark_sent", emailed: 37, refused: [] }) })))).toContain("37 customers were emailed.");
    expect(plain(renderToString(h(ResultPanel, { result: result({ action: "mark_sent", emailed: 1, refused: [] }) })))).toContain("1 customer was emailed.");
    expect(plain(renderToString(h(ResultPanel, { result: result({ refused: [] }) })))).not.toContain("emailed");
  });
});

describe("the saved views tools", () => {
  const views = [
    { id: "22222222-2222-4222-8222-222222222222", title: "VIPs" },
    { id: "33333333-3333-4333-8333-333333333333", title: "Late" },
  ];
  it("saves the list as a view under a name with a limit, and can replace one", () => {
    const html = renderToString(h(ViewTools, { views, query: "pay=paid", actions: viewActions }));
    const text = plain(html);
    expect(text).toContain("Save this list as a view");
    expect(html).toContain('maxLength="40"');
    expect(text).toContain("Or replace a view");
    expect(text).toContain("Manage saved views");
    expect(text).toContain("Do not save a search for a person’s name");
    expect(html).toContain('aria-label="Move VIPs earlier"');
  });
  it("says so when the store has the most views it can", () => {
    const many = Array.from({ length: 30 }, (_, i) => ({ id: `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`, title: `View ${i}` }));
    const html = renderToString(h(ViewTools, { views: many, query: "", actions: viewActions }));
    expect(plain(html)).toContain("A store has at most 30 saved views");
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Save view/);
  });
});
