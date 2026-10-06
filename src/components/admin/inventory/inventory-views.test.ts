import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => {}, refresh: () => {} }) }));
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({}) }));

import type { HistoryRow, InventoryPage, InventoryRow } from "@/server/inventory";

import { HistoryView } from "./history-view";
import { InventoryHead } from "./inventory-head";
import { InventoryTable, type InventoryTools } from "./inventory-table";
import { InventoryView } from "./inventory-view";
import { LocationsView, type LocationRowView, type LocationTools } from "./locations-view";
import { StockExportForm } from "./stock-export-form";
import { StockCheck, StockImportApply, StockUpload } from "./stock-import-flow";
import { StockApplied, StockDryRun, StockFindings, stockResultWords, type StockItem } from "./stock-import-views";

const html = (element: Parameters<typeof renderToString>[0]) =>
  renderToString(element)
    .replace(/<!-- -->/g, "")
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/ /g, " ");

const V1 = "11111111-1111-4111-8111-111111111111";
const L1 = "22222222-2222-4222-8222-222222222222";
const L2 = "33333333-3333-4333-8333-333333333333";

const tools: InventoryTools = { adjust: async () => ({ ok: false, problems: ["x"] }), setPolicy: async () => ({ ok: false, problems: ["x"] }) };

const row = (over: Partial<InventoryRow> = {}): InventoryRow => ({
  variantId: V1,
  productId: "p1",
  handle: "cup",
  title: "Cup",
  productStatus: "active",
  options: { Colour: "Red" },
  sku: "CUP-RED",
  onHand: 12,
  committed: 2,
  available: 10,
  owed: 0,
  stockPolicy: "deny",
  backorderDays: null,
  lowStockThreshold: null,
  locations: [{ locationId: L1, name: "Oslo", active: true, hasLevel: true, onHand: 12, committed: 2, available: 10 }],
  ...over,
});

const twoPlaces = (over: Partial<InventoryRow> = {}) =>
  row({
    onHand: 12,
    locations: [
      { locationId: L1, name: "Oslo", active: true, hasLevel: true, onHand: 7, committed: 2, available: 5 },
      { locationId: L2, name: "Bergen", active: true, hasLevel: true, onHand: 5, committed: 0, available: 5 },
    ],
    ...over,
  });

const locations = [
  { id: L1, name: "Oslo", active: true, priority: 1 },
  { id: L2, name: "Bergen", active: true, priority: 2 },
];

const page = (over: Partial<InventoryPage> = {}): InventoryPage => ({
  rows: [row()],
  nextCursor: null,
  counts: { variants: 1, low: 0, out: 0, owed: 0, negative: 0 },
  locations: [locations[0]],
  applied: { search: "", locationId: null, status: "all" },
  ...over,
});

const query = { search: "", location: null, status: "all" as const, after: null };

describe("the head of an Inventory page", () => {
  it("lists the five tabs and marks the open one", () => {
    const out = html(createElement(InventoryHead, { slug: "shop", active: "history", title: "Stock history", intro: "Why a figure changed." }));
    for (const label of ["Inventory", "History", "Locations", "Import", "Export"]) expect(out).toContain(`>${label}<`);
    expect(out).toMatch(/aria-current="page"[^>]*href="\/admin\/shop\/inventory\/history">History</);
    expect(out).not.toMatch(/aria-current="page"[^>]*href="\/admin\/shop\/inventory">/);
    expect(out).toContain("Why a figure changed.");
  });

  it("links back from a page reached from a tab", () => {
    const out = html(createElement(InventoryHead, { slug: "shop", active: "import", title: "Stock import", intro: "x", back: { href: "/admin/shop/inventory/import", label: "Import stock" } }));
    expect(out).toContain(">Import stock<");
  });
});

describe("the Inventory list", () => {
  it("shows each variant's figures, its policy at zero stock and its warning level", () => {
    const out = html(createElement(InventoryView, { slug: "shop", page: page({ rows: [row({ stockPolicy: "continue", backorderDays: 7, lowStockThreshold: 3 })] }), query, canWrite: false, tools }));
    expect(out).toContain("<caption");
    expect(out).toContain("Cup");
    expect(out).toContain("Red");
    expect(out).toContain("CUP-RED");
    expect(out).toContain("Keep selling: 7 days");
    expect(out).toContain('href="/admin/shop/products/p1"');
    expect(out).toContain('href="/admin/shop/inventory/history?variant=' + V1 + '"');
  });

  it("is plain for a member who cannot change products: no boxes, no review, no tick boxes", () => {
    const out = html(createElement(InventoryView, { slug: "shop", page: page(), query, canWrite: false, tools }));
    expect(out).not.toContain('type="checkbox"');
    expect(out).not.toContain("Review changes");
    expect(out).not.toContain("Set on hand to");
  });

  it("offers a counted figure and a change for a store with one location, and a review before saving", () => {
    const out = html(createElement(InventoryView, { slug: "shop", page: page(), query, canWrite: true, tools }));
    expect(out).toContain("Set on hand to, Cup, Red");
    expect(out).toContain("Adjust on hand by, Cup, Red");
    expect(out).toContain("Review changes");
    expect(out).toContain('aria-label="Choose Cup, Red"');
    // Nothing to review yet, so no way to save.
    expect(out).not.toContain("Save changes");
    // One location: no disclosure of locations and no location filter.
    expect(out).not.toContain("Locations of Cup");
    expect(out).not.toContain('id="inventory-location"');
  });

  it("gives a store with several locations a disclosure with each location's own boxes, and none in the row", () => {
    const out = html(createElement(InventoryView, { slug: "shop", page: page({ rows: [twoPlaces()], locations }), query, canWrite: true, tools }));
    expect(out).toContain("Locations of Cup, Red (2)");
    expect(out).toContain("Set on hand to at Oslo, Cup, Red");
    expect(out).toContain("Set on hand to at Bergen, Cup, Red");
    expect(out).not.toContain("Set on hand to, Cup, Red");
    expect(out).toContain('id="inventory-location"');
    expect(out).toContain("All active locations");
  });

  it("edits a location's figures right in the row when the list is filtered to it", () => {
    const out = html(createElement(InventoryView, { slug: "shop", page: page({ rows: [twoPlaces()], locations, applied: { search: "", locationId: L2, status: "all" } }), query: { ...query, location: L2 }, canWrite: true, tools }));
    expect(out).toContain("Set on hand to, Cup, Red");
    expect(out).not.toContain("Locations of Cup");
    expect(out).toContain("The figures are those of Bergen alone.");
  });

  it("marks what needs a look and counts it, with a link that sets the filter", () => {
    const counts = { variants: 3, low: 2, out: 1, owed: 5, negative: 1 };
    const out = html(createElement(InventoryView, { slug: "shop", page: page({ counts, rows: [row({ onHand: -2, available: -2, stockPolicy: "continue", backorderDays: 7, owed: 2 })] }), query, canWrite: false, tools }));
    expect(out).toContain("At or below the low-stock level");
    expect(out).toContain("Units owed on backorder");
    expect(out).toContain('href="/admin/shop/inventory?status=low"');
    expect(out).toContain('href="/admin/shop/inventory?status=negative"');
    expect(out).toContain("Below zero");
    expect(out).toContain("On backorder");
    expect(out).toContain("Owed");
    // A negative figure is written with a minus sign.
    expect(out).toContain("−2");
  });

  it("never says a sold-out variant is in stock", () => {
    const out = html(createElement(InventoryView, { slug: "shop", page: page({ rows: [row({ onHand: 0, committed: 0, available: 0 })] }), query, canWrite: false, tools }));
    expect(out).toContain("Sold out");
    expect(out).not.toMatch(/in stock/i);
  });

  it("says so when the store has no goods that are shipped, and when a filter matches nothing", () => {
    const empty = html(createElement(InventoryView, { slug: "shop", page: page({ rows: [] }), query, canWrite: true, tools }));
    expect(empty).toContain("No goods that are shipped yet");
    expect(empty).toContain('href="/admin/shop/products/new"');
    expect(empty).not.toContain("<table");
    const none = html(createElement(InventoryView, { slug: "shop", page: page({ rows: [], applied: { search: "zzz", locationId: null, status: "all" } }), query: { ...query, search: "zzz" }, canWrite: true, tools }));
    expect(none).toContain("No variant matches this filter.");
    expect(none).toContain("Clear the filter");
  });

  it("pages with a cursor, keeping the filter", () => {
    const first = html(createElement(InventoryView, { slug: "shop", page: page({ nextCursor: "abc", applied: { search: "cup", locationId: null, status: "low" } }), query: { ...query, search: "cup", status: "low" }, canWrite: false, tools }));
    expect(first).toContain('href="/admin/shop/inventory?q=cup&status=low&after=abc"');
    expect(first).not.toContain("Back to the first page");
    const later = html(createElement(InventoryView, { slug: "shop", page: page(), query: { ...query, after: "abc" }, canWrite: false, tools }));
    expect(later).toContain("Back to the first page");
  });

  it("keeps what is typed in the search box and the chosen status in the filter", () => {
    const out = html(createElement(InventoryView, { slug: "shop", page: page({ applied: { search: "mug", locationId: null, status: "out" } }), query: { ...query, search: "mug", status: "out" }, canWrite: false, tools }));
    expect(out).toContain('value="mug"');
    expect(out).toMatch(/<option value="out" selected/);
  });

  it("writes a name from a customer's data as text, never as markup", () => {
    const out = html(createElement(InventoryTable, { rows: [row({ title: "<img src=x onerror=alert(1)>" })], locations: [locations[0]], chosenLocationId: null, canWrite: false, tools, historyBase: "/h", productBase: "/p" }));
    expect(out).not.toContain("<img src=x");
    expect(out).toContain("&lt;img src=x");
  });
});

describe("the history", () => {
  const entry = (over: Partial<HistoryRow> = {}): HistoryRow => ({
    id: "10",
    createdAt: "2026-10-05T10:00:00Z",
    variantId: V1,
    productId: "p1",
    handle: "cup",
    title: "Cup",
    options: { Colour: "Red" },
    sku: "CUP-RED",
    locationId: L1,
    location: "Oslo",
    delta: -2,
    onHandAfter: 10,
    reason: "sale",
    by: "Order 1001",
    note: null,
    orderId: "o1",
    returnId: null,
    ...over,
  });
  const props = { slug: "shop", rows: [entry()], nextCursor: null, query: { sku: "", variant: null, location: null, reason: null, from: null, to: null, after: null }, locations: [{ id: L1, name: "Oslo", active: true }], timeZone: "Europe/Oslo" };

  it("lists the change, the new figure, the reason and who or what made it, with a link to the order", () => {
    const out = html(createElement(HistoryView, props));
    expect(out).toContain("<caption");
    expect(out).toContain("−2");
    expect(out).toContain("Sale");
    expect(out).toContain('href="/admin/shop/orders/o1"');
    expect(out).toContain("Order 1001");
    expect(out).toContain("kept for 24 months");
    expect(out).toContain('href="/admin/shop/inventory/history?variant=' + V1 + '"');
  });

  it("links a return's change to the return, and shows a staff member's note as text", () => {
    const out = html(createElement(HistoryView, { ...props, rows: [entry({ reason: "return_restock", by: "Return R-12", orderId: "o1", returnId: "r1", delta: 1, note: "<b>box</b>" })] }));
    expect(out).toContain("Return put back");
    expect(out).toContain("&lt;b&gt;box&lt;/b&gt;");
    expect(out).not.toContain("<b>box</b>");
  });

  it("says so when nothing matches, filters by what the address holds, and pages with the last id", () => {
    const none = html(createElement(HistoryView, { ...props, rows: [], query: { ...props.query, sku: "NOPE", reason: "damaged" } }));
    expect(none).toContain("No change matches this filter.");
    expect(none).toContain('value="NOPE"');
    expect(none).toMatch(/<option value="damaged" selected/);
    const paged = html(createElement(HistoryView, { ...props, nextCursor: "9", query: { ...props.query, after: "20" } }));
    expect(paged).toContain('href="/admin/shop/inventory/history?after=9"');
    expect(paged).toContain("Back to the newest");
  });

  it("holds the filter of one variant", () => {
    const out = html(createElement(HistoryView, { ...props, query: { ...props.query, variant: V1 } }));
    expect(out).toContain(`name="variant" value="${V1}"`);
    expect(out).toContain("Showing the changes of one variant.");
  });
});

describe("the stock locations", () => {
  const locationTools: LocationTools = {
    save: async () => ({ ok: false, problem: "x" }),
    move: async () => ({ ok: true }),
    deactivate: async () => ({ ok: false, problem: "x" }),
    reactivate: async () => ({ ok: false, problem: "x" }),
  };
  const impact = { units: 12, variants: 3, committedUnits: 0, owedUnits: 0 };
  const rows: LocationRowView[] = [
    { id: L1, name: "Oslo", country: "NO", active: true, priority: 1, units: 12, variants: 3, impact },
    { id: L2, name: "Bergen", country: "NO", active: false, priority: 2, units: 4, variants: 1, impact: null },
  ];
  const countries = [{ code: "NO", name: "Norway" }, { code: "SE", name: "Sweden" }];

  it("lists the locations in the order orders are taken in, with what each holds", () => {
    const out = html(createElement(LocationsView, { rows, countries, canWrite: true, isOwner: false, tools: locationTools }));
    expect(out).toContain("Orders are taken from the top location first");
    expect(out).toContain("Oslo");
    expect(out).toContain("12 units across 3 variants");
    expect(out).toContain("Inactive: its stock is not for sale");
    expect(out).toContain("Norway");
    expect(out).toContain("Move up");
    expect(out).toContain('aria-label="Rename Oslo"');
    expect(out).toContain('aria-label="Add a location"');
  });

  it("offers deactivating and reactivating to the owner only, and says why to a member who is not", () => {
    const member = html(createElement(LocationsView, { rows, countries, canWrite: true, isOwner: false, tools: locationTools }));
    expect(member).not.toContain("Deactivate Oslo");
    expect(member).not.toContain("Reactivate Bergen");
    expect(member).toContain("Only the store&apos;s owner can deactivate".replace("&apos;", "'"));
    const owner = html(createElement(LocationsView, { rows, countries, canWrite: true, isOwner: true, tools: locationTools }));
    expect(owner).toContain('aria-label="Reactivate Bergen"');
    expect(owner).toContain('aria-label="Deactivate Oslo"');
    // Oslo is the only active location, so it cannot be deactivated.
    expect(owner).toMatch(/aria-label="Deactivate Oslo"[^>]*disabled|disabled=""[^>]*aria-label="Deactivate Oslo"|title="A store keeps at least one active location\."/);
  });

  it("lets a person who can only read look and nothing else", () => {
    const out = html(createElement(LocationsView, { rows, countries, canWrite: false, isOwner: false, tools: locationTools }));
    expect(out).toContain("Oslo");
    expect(out).not.toContain("Add a location");
    expect(out).not.toContain("Rename Oslo");
    expect(out).not.toContain("Move up");
  });
});

describe("the stock file", () => {
  it("asks only for the file's format and posts to the page's own route", () => {
    const out = html(createElement(StockExportForm, { slug: "shop" }));
    expect(out).toContain('method="post"');
    expect(out).toContain('action="/admin/shop/inventory/export/file"');
    expect(out).toContain('name="dialect"');
    expect(out).toContain("Export stock");
  });

  it("asks for a CSV file and says which columns it reads", () => {
    const out = html(createElement(StockUpload, { slug: "shop", start: async () => ({ ok: false as const, problem: "x" }), register: async () => ({ ok: false as const, problems: ["x"] }) }));
    expect(out).toContain('type="file"');
    expect(out).toContain("on_hand_was");
    expect(out).toContain("Nothing is changed until you have seen the check and pressed Import.");
  });

  it("checks the file before anything is imported", () => {
    expect(html(createElement(StockCheck, { check: async () => ({ ok: true as const }), checked: false }))).toContain("Check the file");
    expect(html(createElement(StockCheck, { check: async () => ({ ok: true as const }), checked: true }))).toContain("Check the file again");
  });

  it("counts what the check found, and imports only when something can be", () => {
    const counts = { toUpdate: 4, unchanged: 1, conflicts: 2, withProblems: 3 };
    const dry = html(createElement(StockDryRun, { counts }));
    expect(dry).toContain("To change");
    expect(dry).toContain("Out of date");
    expect(dry).toContain("Nothing has changed in your store.");
    const apply = html(createElement(StockImportApply, { counts, apply: async () => ({ ok: true as const }), cancel: async () => ({ ok: true as const }) }));
    expect(apply).toContain("4 to change, 1 unchanged, 2 out of date, 3 with problems.");
    expect(apply).toContain("Import …");
    const nothing = html(createElement(StockImportApply, { counts: { toUpdate: 0, unchanged: 0, conflicts: 0, withProblems: 2 }, apply: async () => ({ ok: true as const }), cancel: async () => ({ ok: true as const }) }));
    expect(nothing).toContain("No row of this file can be imported.");
    expect(nothing).toMatch(/disabled=""[^>]*>Import …/);
  });

  it("says what an import did, with a reference for the history", () => {
    const out = html(createElement(StockApplied, { counts: { updated: 5, unchanged: 1, skipped: 2, failed: 0 }, jobId: "job-1", written: true }));
    expect(out).toContain("What was imported");
    expect(out).toContain("job-1");
    expect(html(createElement(StockApplied, { counts: { updated: 1, unchanged: 0, skipped: 0, failed: 0 }, jobId: "job-1", written: false }))).toContain("before it stopped");
  });

  const item = (over: Partial<StockItem> = {}): StockItem => ({ seq: 1, ref: "CUP-RED", rows: [2], outcome: "checked", will: "update", location: "Oslo", current: 10, next: 15, change: 5, messages: [], ...over });
  const findings = (items: StockItem[], severity: "all" | "error" | "warning" | "info" = "all") =>
    html(createElement(StockFindings, { items, total: items.length, severity, page: 1, pageSize: 50, hrefFor: (q) => `/x?severity=${q.severity ?? "all"}`, problemsHref: "/x/problems" }));

  it("lists each row with its figures, what it would do, and findings that name only a SKU", () => {
    const out = findings([
      item(),
      item({ seq: 2, ref: "CUP-BLUE", rows: [3], will: "conflict", current: 4, next: 4, change: 0, messages: [{ code: "stockfile.conflict", severity: "warning", text: "CUP-BLUE: the stock was 9 when the file was made and is 4 now.", column: "on_hand_was" }] }),
      item({ seq: 3, ref: null, rows: [1], will: null, location: null, current: null, next: null, change: null, messages: [{ code: "file.not_inventory", severity: "error", text: "The file needs the columns sku and on_hand." }] }),
    ]);
    expect(out).toContain("CUP-RED");
    expect(out).toContain("Would be changed");
    expect(out).toContain("+5");
    expect(out).toContain("Out of date: left alone");
    expect(out).toContain("stockfile.conflict");
    expect(out).toContain("The file as a whole");
    expect(out).toContain("Download the problems as CSV");
    expect(out).toMatch(/whitespace-nowrap">2<\/td>/);
  });

  it("names the result of an applied row, and says so when no row has a finding of a kind", () => {
    expect(stockResultWords({ outcome: "updated", will: null })).toBe("Changed");
    expect(stockResultWords({ outcome: "skipped", will: null })).toBe("Skipped");
    expect(stockResultWords({ outcome: "checked", will: "skip" })).toBe("Would be skipped");
    expect(stockResultWords({ outcome: "checked", will: null })).toBe("Checked");
    expect(findings([], "error")).toContain("No row has a finding of this kind.");
    expect(findings([], "all")).toContain("Nothing to show.");
  });
});
