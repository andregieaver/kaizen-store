import { createElement, type ComponentProps } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => {}, refresh: () => {} }) }));
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({}) }));
vi.mock("@/app/admin/(gated)/[store]/orders/export/actions", () => ({ checkNumbersAction: async () => ({ ok: true, found: [], unknown: [], over: 0 }) }));

import { DEFAULT_IMPORT_OPTIONS } from "@/lib/product-import";

import { CustomerExportForm, OrderExportForm, ProductExportForm } from "./export-forms";
import { FindingsTable, outcomeWords, type FindingItem } from "./findings-table";
import { ImportApply, ImportOptionsForm, ImportUpload } from "./import-flow";
import { AppliedSummary, DryRunSummary } from "./import-summary";
import { ExportFiles, ExportJobList, JobProgressView, type ExportJobRow, type JobView } from "./job-views";
import { DataPageHead, Notice, ProblemAlert } from "./page-parts";

const html = (element: Parameters<typeof renderToString>[0]) =>
  renderToString(element)
    .replace(/<!-- -->/g, "")
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/ /g, " ");

const job = (over: Partial<JobView> = {}): JobView => ({ id: "11111111-1111-4111-8111-111111111111", kind: "product_import", status: "running", phase: "apply", rowsDone: 40, rowsTotal: 200, problem: null, ...over });
const exportJob = (over: Partial<ExportJobRow> = {}): ExportJobRow => ({
  ...job({ kind: "order_export", status: "done", phase: "assemble", rowsDone: 5000, rowsTotal: 5000 }),
  createdAt: "2026-10-05T10:00:00Z",
  expiresAt: "2026-10-12T10:00:00Z",
  purged: false,
  files: [
    { index: 0, name: "orders-1.csv", rows: 3000, bytes: 3_670_016 },
    { index: 1, name: "orders-2.csv", rows: 2000, bytes: 812 },
  ],
  ...over,
});
const now = new Date("2026-10-05T12:00:00Z");

describe("the progress of a job", () => {
  it("draws a bar with its numbers for a job being worked on", () => {
    const out = html(createElement(JobProgressView, { job: job() }));
    expect(out).toContain("Saving products");
    expect(out).toContain('role="progressbar"');
    expect(out).toContain('aria-valuenow="20"');
    expect(out).toContain("40 of 200 products");
    expect(out).toContain("You can leave this page");
  });

  it("says a check is a check, and an export is being prepared", () => {
    expect(html(createElement(JobProgressView, { job: job({ status: "checking", phase: "check" }) }))).toContain("Checking the file");
    expect(html(createElement(JobProgressView, { job: job({ kind: "order_export", status: "running", phase: "write" }) }))).toContain("Preparing your file");
  });

  it("shows the plain reason a job stopped, and no bar", () => {
    const out = html(createElement(JobProgressView, { job: job({ status: "failed", problem: "Storage was not available, so the job could not be finished. Try again later." }) }));
    expect(out).toContain("Stopped with a problem");
    expect(out).toContain("Storage was not available");
    expect(out).not.toContain("progressbar");
  });
});

describe("a finished export", () => {
  it("lists each file with a Download button that POSTs to the page's file route, and no standing link", () => {
    const out = html(createElement(ExportFiles, { job: exportJob(), action: "/admin/shop/orders/export/file", timeZone: "Europe/Oslo", now }));
    expect(out).toContain("Your 2 files are ready");
    expect(out).toContain("orders-1.csv");
    expect(out).toContain("3.5 MB");
    expect(out).toContain("812 B");
    expect(out).toContain("expires in 6 days");
    expect(out).toContain('method="post"');
    expect(out).toContain('action="/admin/shop/orders/export/file"');
    expect(out).toContain('name="intent" value="download"');
    expect(out).toContain('name="part" value="1"');
    expect(out).toContain('name="job" value="11111111-1111-4111-8111-111111111111"');
    // The address of a file is made when the button is pressed: nothing here points at storage.
    expect(out).not.toMatch(/https?:\/\//);
    expect(out).not.toContain("exports/");
  });

  it("draws nothing for a job that is not done, was purged or has no file", () => {
    for (const over of [{ status: "running" as const }, { purged: true }, { files: [] }, { status: "expired" as const }]) {
      expect(html(createElement(ExportFiles, { job: exportJob(over), action: "/x", timeZone: "UTC", now }))).toBe("");
    }
  });

  it("lists the recent exports, Download only for one that can still be downloaded", () => {
    const out = html(createElement(ExportJobList, { jobs: [exportJob(), exportJob({ id: "22222222-2222-4222-8222-222222222222", status: "expired", purged: true, files: [] })], pageHref: "/admin/shop/orders/export", timeZone: "UTC", now }));
    expect(out).toContain("<caption");
    expect(out).toContain("Recent exports");
    expect(out).toContain('href="/admin/shop/orders/export?job=11111111-1111-4111-8111-111111111111"');
    expect(out).toContain(">Download<");
    expect(out).toContain(">Open<");
    expect(html(createElement(ExportJobList, { jobs: [], pageHref: "/x", timeZone: "UTC", now }))).toBe("");
  });
});

describe("the findings of an import", () => {
  const items: FindingItem[] = [
    { seq: 0, ref: "red-shirt", rows: [2, 3, 4], outcome: "checked", will: "created", messages: [{ severity: "warning", code: "value.cleared", column: "title:sv-SE", text: 'The "title:sv-SE" column is empty, so the value is cleared.' }] },
    { seq: 1, ref: "<script>alert(1)</script>", rows: [9], outcome: "failed", will: null, messages: [{ severity: "error", code: "sku.in_other_product", text: "This SKU belongs to another product." }] },
    { seq: 2, ref: null, rows: [], outcome: "checked", will: null, messages: [{ severity: "info", code: "column.ignored", text: "The Vendor column was ignored." }] },
  ];
  const hrefFor = (q: { severity?: string; page?: number }) => `/p?severity=${q.severity ?? "all"}&page=${q.page ?? 1}`;
  const base = { items, total: 3, severity: "all" as const, page: 1, pageSize: 50, hrefFor, problemsHref: "/admin/shop/products/import/j/problems" };

  it("shows rows, product, result, severity, code and the sentence", () => {
    const out = html(createElement(FindingsTable, base));
    expect(out).toContain("<caption");
    expect(out).toContain("2, 3 and 4");
    expect(out).toContain("red-shirt");
    expect(out).toContain("Would be created");
    expect(out).toContain("value.cleared");
    expect(out).toContain("sku.in_other_product");
    expect(out).toContain("This SKU belongs to another product.");
    expect(out).toContain("Failed");
  });

  it("escapes a handle that is markup", () => {
    const out = renderToString(createElement(FindingsTable, base));
    expect(out).not.toContain("<script>");
    expect(out).toContain("&lt;script&gt;");
  });

  it("offers the filters through the address, marks the current one and downloads the problems by POST", () => {
    const out = html(createElement(FindingsTable, { ...base, severity: "error" }));
    expect(out).toContain('href="/p?severity=error&page=1"');
    expect(out).toMatch(/aria-current="page"[^>]*>Errors</);
    expect(out).toContain('action="/admin/shop/products/import/j/problems" method="post"');
    expect(out).toContain("Download the problems as CSV");
  });

  it("says so when a filter finds nothing, and pages a long list", () => {
    expect(html(createElement(FindingsTable, { ...base, items: [], total: 0, severity: "error" }))).toContain("No product has a finding of this kind.");
    const paged = html(createElement(FindingsTable, { ...base, total: 120, page: 2 }));
    expect(paged).toContain("Page 2 of 3");
    expect(paged).toContain("Earlier products");
    expect(paged).toContain("Later products");
  });

  it("words the result of an item", () => {
    expect(outcomeWords({ outcome: "checked", will: "drafted" })).toBe("Would be saved as a draft");
    expect(outcomeWords({ outcome: "drafted", will: null })).toBe("Saved as a draft");
    expect(outcomeWords({ outcome: "checked", will: null })).toBe("Checked");
  });
});

describe("the import summaries", () => {
  it("shows what the check found, and that nothing changed", () => {
    const out = html(createElement(DryRunSummary, { counts: { toCreate: 12, toUpdate: 3, unchanged: 5, withProblems: 2 } }));
    expect(out).toContain("To create");
    expect(out).toContain(">12<");
    expect(out).toContain("Nothing has changed in your store");
  });

  it("shows what was imported, with the reference of the activity log", () => {
    const counts = { created: 10, updated: 2, unchanged: 1, skipped: 1, drafted: 3, failed: 0, warnings: 4, errors: 1, pricesChanged: 14, picturesFetched: 20, termsCreated: 2 };
    const out = html(createElement(AppliedSummary, { counts, jobId: "abc", written: true }));
    expect(out).toContain("What was imported");
    expect(out).toContain("Saved as drafts");
    expect(out).toContain("Prices changed: 14");
    expect(out).toContain("<code>abc</code>");
    expect(html(createElement(AppliedSummary, { counts, jobId: "abc", written: false }))).toContain("before it stopped");
  });
});

describe("the import forms", () => {
  const choices = (format: "kaizen" | "shopify", markets = 2) => ({
    format,
    markets: [
      { code: "NO", name: "Norway", currency: "NOK" },
      { code: "SE", name: "Sweden", currency: "SEK" },
    ].slice(0, markets),
    operators: [{ id: "op-1", name: "Acme AS" }],
    initial: DEFAULT_IMPORT_OPTIONS,
    audience: "consumers" as const,
  });
  const check = async () => ({ ok: true as const });

  it("asks for the file", () => {
    const out = html(createElement(ImportUpload, { slug: "shop", start: async () => ({ ok: false as const, problem: "x" }), register: async () => ({ ok: false as const, problems: [] }) }));
    expect(out).toContain('type="file"');
    expect(out).toContain("15.0 MB");
    expect(out).toContain("Nothing is changed until you have seen the check");
  });

  it("offers the options, the safe defaults first", () => {
    const out = html(createElement(ImportOptionsForm, { choices: choices("kaizen"), check, checked: false }));
    expect(out).toContain("Create new products and update existing ones");
    expect(out).toContain("Save it as a draft and list why");
    expect(out).toContain("Acme AS");
    expect(out).toContain("Keep them as they are");
    expect(out).toContain("never used as the manufacturer");
    expect(out).toContain("Check the file");
    expect(out).not.toContain("Do the prices in the file include VAT");
  });

  it("makes a Shopify file say whether its prices include VAT, with no default, and holds the button until it does", () => {
    const out = html(createElement(ImportOptionsForm, { choices: choices("shopify"), check, checked: false }));
    expect(out).toContain("This is a Shopify file");
    expect(out).toContain("Do the prices in the file include VAT?");
    expect(out).toContain("There is no default");
    expect(out).not.toMatch(/name="basis"[^>]*checked/);
    expect(out).toMatch(/<button type="submit" disabled=""/);
    expect(out).toContain("Say whether the prices include VAT first.");
    expect(out).toContain("The market of the Price column");
    expect(html(createElement(ImportOptionsForm, { choices: choices("shopify", 1), check, checked: false }))).not.toContain("The market of the Price column");
  });

  it("offers a second check for a checked file", () => {
    expect(html(createElement(ImportOptionsForm, { choices: choices("kaizen"), check, checked: true }))).toContain("Check the file again");
  });

  it("shows the counts and holds the import behind a confirmation", () => {
    const out = html(createElement(ImportApply, { counts: { toCreate: 5, toUpdate: 2, unchanged: 1, withProblems: 3 }, apply: check, cancel: check }));
    expect(out).toContain("5 to create, 2 to update, 1 unchanged, 3 with problems");
    expect(out).toContain("Import …");
    expect(out).toContain("Cancel this import");
    expect(out).not.toContain("You cannot undo an import as a whole");
  });

  it("refuses to offer an import of nothing", () => {
    const out = html(createElement(ImportApply, { counts: { toCreate: 0, toUpdate: 0, unchanged: 0, withProblems: 4 }, apply: check, cancel: check }));
    expect(out).toContain("No product in this file can be imported");
    expect(out).toMatch(/<button type="button" disabled=""[^>]*>Import …/);
  });
});

describe("the export forms", () => {
  it("posts the product export to its file route with a choice of products, format and pictures", () => {
    const out = html(createElement(ProductExportForm, { slug: "shop", terms: [{ id: "t1", name: "Shirts", kind: "category" }, { id: "t2", name: "Sale", kind: "tag" }] }));
    expect(out).toContain('action="/admin/shop/products/export/file" method="post"');
    expect(out).toContain('name="scope" checked="" value="all"');
    expect(out).toContain('name="status"');
    expect(out).toContain("Category: Shirts");
    expect(out).toContain("Tag: Sale");
    expect(out).toContain('name="dialect"');
    expect(out).toContain("Standard (comma");
    expect(out).toContain("Excel (Nordic");
    expect(out).toMatch(/name="dialect"[^>]*>\s*<option value="standard" selected=""/);
    expect(out).toContain('name="pictures" checked="" value="true"');
  });

  it("leaves out the category choice for a store with none", () => {
    expect(html(createElement(ProductExportForm, { slug: "shop", terms: [] }))).not.toContain('name="termId"');
  });

  it("starts the order export minimal: paid orders, a row per line, no contact details, Nordic Excel, copied history off", () => {
    const out = html(createElement(OrderExportForm, { slug: "shop", defaultNumbers: "", today: "2026-10-05" }));
    expect(out).toContain('action="/admin/shop/orders/export/file"');
    expect(out).toContain('name="mode" checked="" value="range"');
    expect(out).toContain('name="from" value="2026-09-05"');
    expect(out).toContain('name="to" value="2026-10-05"');
    expect(out).toContain('name="which" checked="" value="paid"');
    expect(out).toContain('name="layout" checked="" value="lines"');
    expect(out).toContain('name="profile" checked="" value="accounting"');
    expect(out).not.toMatch(/name="profile" checked="" value="full"/);
    expect(out).not.toMatch(/name="copied" checked=""/);
    expect(out).toMatch(/<option value="excel_nordic" selected=""/);
    expect(out).toContain("without the buyer's email, name or address");
    expect(out).toContain("An order whose person was erased never carries any");
  });

  it("opens on the selection when an order's page sent a number", () => {
    const out = html(createElement(OrderExportForm, { slug: "shop", defaultNumbers: "1007", today: "2026-10-05" }));
    expect(out).toContain('name="mode" checked="" value="numbers"');
    expect(out).toContain("1007</textarea>");
    expect(out).toContain("At most 500 order numbers");
  });

  it("posts the customer export", () => {
    const out = html(createElement(CustomerExportForm, { slug: "shop" }));
    expect(out).toContain('action="/admin/shop/customers/export/file"');
    expect(out).toContain("once per email address");
  });
});

describe("page parts", () => {
  it("draws the head, a notice and a problem as text", () => {
    expect(html(createElement(DataPageHead, { backHref: "/admin/shop/orders", backLabel: "Orders", title: "Export orders", intro: "A spreadsheet." }))).toContain("<h1");
    expect(html(createElement(Notice, { title: "Personal data", tone: "warning" } as ComponentProps<typeof Notice>, "Careful"))).toContain('role="note"');
    expect(html(createElement(ProblemAlert, { text: null }))).toBe("");
    expect(html(createElement(ProblemAlert, { text: "Choose a narrower period." }))).toContain('role="alert"');
  });
});
