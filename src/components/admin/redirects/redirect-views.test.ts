import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => {}, refresh: () => {} }) }));
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({}) }));

import type { FindingItem } from "@/components/admin/data/findings-table";
import { finding } from "@/lib/data-job";

import { NotFoundTable, type MissingRow, type ReportActions } from "./not-found-table";
import { RedirectExportForm } from "./redirect-export-form";
import { RedirectForm, type RedirectFormActions } from "./redirect-form";
import { RedirectsHead } from "./redirect-head";
import { RedirectImportApply, RedirectImportOptions, RedirectUpload } from "./redirect-import-flow";
import { RedirectApplied, RedirectDryRun, RedirectFindings } from "./redirect-import-views";
import { RedirectTable, type RedirectTableActions, type TableRow } from "./redirect-table";

const html = (element: Parameters<typeof renderToString>[0]) =>
  renderToString(element)
    .replace(/<!-- -->/g, "")
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/&gt;/g, ">")
    .replace(/&lt;/g, "<");

const okStep = async () => ({ ok: true as const });
const none = async () => ({ ok: false as const, problems: ["x"], findings: [] });
const formActions: RedirectFormActions = { check: async () => ({ ok: false, problems: ["x"] }), save: none };
const tableActions: RedirectTableActions = { ...formActions, remove: async () => ({ ok: true, deleted: 1 }) };

describe("the head of a redirect page", () => {
  it("shows the title, the intro and the four tabs, marking the current one", () => {
    const out = html(createElement(RedirectsHead, { slug: "demo", active: "report", title: "Pages not found", intro: "Intro text." }));
    expect(out).toContain("<h1");
    expect(out).toContain("Pages not found");
    expect(out).toContain("Intro text.");
    for (const [href, label] of [
      ["/admin/demo/redirects", "Redirects"],
      ["/admin/demo/redirects/404s", "Pages not found"],
      ["/admin/demo/redirects/import", "Import"],
      ["/admin/demo/redirects/export", "Export"],
    ]) {
      expect(out).toContain(`href="${href}"`);
      expect(out).toContain(`>${label}<`);
    }
    expect(out).toMatch(/aria-current="page"[^>]*>Pages not found</);
    expect(out.match(/aria-current="page"/g)).toHaveLength(1);
  });

  it("draws a back link when it is given one", () => {
    const out = html(createElement(RedirectsHead, { slug: "demo", active: "import", title: "T", intro: "I", back: { href: "/admin/demo/redirects/import", label: "Import redirects" } }));
    expect(out).toContain(">Import redirects<");
  });
});

describe("the form that adds a redirect", () => {
  it("has the two fields, an example line and a disabled button until both are filled", () => {
    const out = html(createElement(RedirectForm, { actions: formActions }));
    expect(out).toContain("Redirect from");
    expect(out).toContain("Redirect to");
    expect(out).toContain('placeholder="/collections/shoes"');
    expect(out).toContain("Shoppers who open /collections/shoes in any country go to /category/shoes in the same country.");
    expect(out).toMatch(/<button type="submit" disabled=""[^>]*>Add the redirect</);
  });

  it("starts with an editing redirect's addresses and says Save the change", () => {
    const out = html(createElement(RedirectForm, { actions: formActions, initial: { from: "/old", to: "/new" }, editing: { id: "1", source: "/old" }, onCancel: () => {} }));
    expect(out).toContain('value="/old"');
    expect(out).toContain('value="/new"');
    expect(out).toContain("Save the change");
    expect(out).toContain(">Cancel<");
  });
});

const row = (over: Partial<TableRow> = {}): TableRow => ({
  id: "r1",
  kind: "manual",
  source: "/collections/shoes",
  target: "/category/shoes",
  origin: "editor",
  hits: 12,
  lastHitAt: "2026-10-05T10:00:00Z",
  createdAt: "2026-10-01T10:00:00Z",
  createdBy: "Kari",
  readOnly: false,
  status: "active",
  more: 0,
  ...over,
});

describe("the list of redirects", () => {
  const rows: TableRow[] = [
    row(),
    row({ id: "r2", source: "/old", status: "not_used" }),
    row({ id: "r3", source: "/gone", target: "/p/none", status: "target_missing" }),
    row({ id: "r4", source: "/a", target: "/c", status: "chain", more: 2 }),
    row({ id: "r5", kind: "product", origin: "system", createdBy: null, source: "/p/old-cup", target: "/p/new-cup", hits: 0 }),
    row({ id: "r6", kind: "category", origin: "system", createdBy: null, source: "/category/old", target: null }),
    row({ id: "r7", kind: "page", origin: "system", createdBy: null, source: "/om-oss-gammel", target: "/om-oss", hits: null, readOnly: true }),
  ];

  it("shows from, to, kind, use, who and when, and a status in words for every state", () => {
    const out = html(createElement(RedirectTable, { rows, timeZone: "UTC", actions: tableActions, canWrite: true }));
    expect(out).toContain("<caption");
    for (const word of ["From", "To", "Kind", "Used", "Made", "Status"]) expect(out).toContain(`>${word}<`);
    expect(out).toContain("/collections/shoes");
    expect(out).toContain("/category/shoes");
    expect(out).toContain("Active");
    expect(out).toContain("Not used: this address is live");
    expect(out).toContain("Target not found");
    expect(out).toContain("Goes through 2 more redirects");
    expect(out).toContain("At least 12, last 5 Oct 2026, 10:00");
    expect(out).toContain("Not used yet");
    expect(out).toContain("Not counted");
    expect(out).toContain("Added by Kari");
    expect(out).toContain("Automatic");
    expect(out).toContain("Not live now: shoppers get the not-found page");
  });

  it("offers edit, delete and selection to a member who may change the website, but never for a page's own redirect", () => {
    const out = html(createElement(RedirectTable, { rows, timeZone: "UTC", actions: tableActions, canWrite: true }));
    expect(out).toContain("Select every redirect on this page");
    expect(out).toContain("Edit the redirect from /collections/shoes");
    expect(out).toContain("Delete the redirect from /collections/shoes");
    // An automatic one is replaced, not edited.
    expect(out).toContain("Replace the redirect from /p/old-cup");
    expect(out).not.toContain("Select the redirect from /om-oss-gammel");
    expect(out).not.toContain("Delete the redirect from /om-oss-gammel");
  });

  it("draws no control for a member who may only read", () => {
    const out = html(createElement(RedirectTable, { rows, timeZone: "UTC", actions: tableActions, canWrite: false }));
    expect(out).not.toContain('type="checkbox"');
    expect(out).not.toContain("Delete the redirect");
    expect(out).not.toContain("Edit the redirect");
    expect(out).toContain("/collections/shoes");
  });

  it("escapes an address that is markup", () => {
    const out = renderToString(createElement(RedirectTable, { rows: [row({ source: "/<script>alert(1)</script>" })], timeZone: "UTC", actions: tableActions, canWrite: true }));
    expect(out).not.toContain("<script>alert");
    expect(out).toContain("&lt;script&gt;");
  });
});

describe("the import's screens", () => {
  it("offers the upload with the columns and the limits", () => {
    const out = html(createElement(RedirectUpload, { slug: "demo", start: async () => ({ ok: false as const, problem: "x" }), register: async () => ({ ok: false as const, problems: ["x"] }) }));
    expect(out).toContain("A CSV file of redirects");
    expect(out).toContain("Redirect from");
    expect(out).toContain("Redirect to");
    expect(out).toContain("100,000 lines");
    expect(out).toContain("Upload and read the file");
    expect(out).toContain('accept=".csv,text/csv"');
  });

  it("offers the one option, with what it does, and the check", () => {
    const out = html(createElement(RedirectImportOptions, { initial: "replace", check: okStep, checked: false }));
    expect(out).toContain("A redirect from the same address already exists");
    expect(out).toContain("Replace its target with the one in the file");
    expect(out).toContain("Keep the redirect that is there and skip the line");
    expect(out).toContain("Check the file");
    expect(html(createElement(RedirectImportOptions, { initial: "skip", check: okStep, checked: true }))).toContain("Check the file again");
  });

  it("shows what the check found, and what an import wrote", () => {
    const dry = html(createElement(RedirectDryRun, { counts: { toCreate: 10, toReplace: 2, unchanged: 3, skipped: 1, withErrors: 4 } }));
    for (const word of ["To create", "To replace", "Unchanged", "Skipped", "With errors"]) expect(dry).toContain(word);
    expect(dry).toContain("Nothing has changed in your store");
    const done = html(createElement(RedirectApplied, { counts: { created: 10, updated: 2, unchanged: 3, skipped: 1, failed: 4 }, jobId: "job-1", written: true }));
    expect(done).toContain("What was imported");
    expect(done).toContain("job-1");
    expect(html(createElement(RedirectApplied, { counts: { created: 1, updated: 0, unchanged: 0, skipped: 0, failed: 0 }, jobId: "j", written: false }))).toContain("before it stopped");
  });

  it("asks for confirmation before importing, and disables the button when nothing can be imported", () => {
    const counts = { toCreate: 10, toReplace: 2, unchanged: 3, skipped: 0, withErrors: 1 };
    const out = html(createElement(RedirectImportApply, { counts, apply: okStep, cancel: okStep }));
    expect(out).toContain("10 to create, 2 to replace, 3 unchanged, 1 with errors.");
    expect(out).toContain("Import …");
    expect(out).toContain("Cancel this import");
    const empty = html(createElement(RedirectImportApply, { counts: { toCreate: 0, toReplace: 0, unchanged: 0, skipped: 0, withErrors: 5 }, apply: okStep, cancel: okStep }));
    expect(empty).toMatch(/<button type="button" disabled=""[^>]*>Import …/);
    expect(empty).toContain("No line of this file can be imported");
  });

  const items: FindingItem[] = [
    { seq: 0, ref: null, rows: [], outcome: "checked", will: null, messages: [finding("file.not_redirects", { names: ["Redirect from", "Redirect to"] })] },
    { seq: 1, ref: "/collections/shoes", rows: [2], outcome: "checked", will: "created", messages: [finding("target.not_found", { address: "/category/none" })] },
    { seq: 2, ref: "/p/live-cup", rows: [3], outcome: "checked", will: "failed", messages: [finding("source.live", { address: "/p/live-cup" })] },
    { seq: 3, ref: "/<script>alert(1)</script>", rows: [4, 5, 6], outcome: "failed", will: null, messages: [] },
  ];
  const hrefFor = (q: { severity?: string; page?: number }) => `/p?severity=${q.severity ?? "all"}&page=${q.page ?? 1}`;
  const props = { items, total: 4, severity: "all" as const, page: 1, pageSize: 50, hrefFor, problemsHref: "/admin/demo/redirects/import/j/problems" };

  it("lists every line with its rows, address, result, severity, code and sentence", () => {
    const out = html(createElement(RedirectFindings, props));
    expect(out).toContain("<caption");
    expect(out).toContain("Redirect from");
    expect(out).toContain("/collections/shoes");
    expect(out).toContain("Would be created");
    expect(out).toContain("Would not be imported");
    expect(out).toContain("target.not_found");
    expect(out).toContain("source.live");
    expect(out).toContain("4, 5 and 6");
    expect(out).toContain("The file as a whole");
    expect(out).toContain("file.not_redirects");
    expect(out).toContain("Not imported");
  });

  it("escapes an address that is markup", () => {
    const out = renderToString(createElement(RedirectFindings, props));
    expect(out).not.toContain("<script>alert");
    expect(out).toContain("&lt;script&gt;");
  });

  it("filters through the address, downloads the problems by POST, and pages a long list", () => {
    const out = html(createElement(RedirectFindings, { ...props, severity: "error" }));
    expect(out).toContain('href="/p?severity=error&page=1"');
    expect(out).toMatch(/aria-current="page"[^>]*>Errors</);
    expect(out).toContain('action="/admin/demo/redirects/import/j/problems" method="post"');
    expect(html(createElement(RedirectFindings, { ...props, items: [], total: 0, severity: "warning" }))).toContain("No line has a finding of this kind.");
    const paged = html(createElement(RedirectFindings, { ...props, total: 130, page: 2 }));
    expect(paged).toContain("Page 2 of 3");
    expect(paged).toContain("Earlier lines");
    expect(paged).toContain("Later lines");
  });
});

describe("the redirect file's form", () => {
  it("posts to the page's file route with the choice of redirects and the format", () => {
    const out = html(createElement(RedirectExportForm, { slug: "demo" }));
    expect(out).toContain('method="post"');
    expect(out).toContain('action="/admin/demo/redirects/export/file"');
    expect(out).toMatch(/name="scope" checked="" value="manual"/);
    expect(out).toContain('name="scope" value="all"');
    expect(out).toContain('name="dialect"');
    expect(out).toContain("Excel (Nordic)");
    expect(out).toContain("Export redirects");
  });
});

describe("the report of pages not found", () => {
  const rows: MissingRow[] = [
    { path: "/collections/shoes", requests: 40, crawlers: 12, lastAsked: "2026-10-05T10:00:00Z", covered: false, ignored: false, suggestions: [{ kind: "category", path: "/category/shoes", title: "Shoes" }, { kind: "product", path: "/p/shoe", title: "A shoe" }] },
    { path: "/zzz", requests: 1, crawlers: 0, lastAsked: "2026-10-04T10:00:00Z", covered: false, ignored: false, suggestions: [] },
    { path: "/fixed", requests: 7, crawlers: 0, lastAsked: "2026-10-03T10:00:00Z", covered: true, ignored: false, suggestions: [] },
  ];
  const actions: ReportActions = { redirect: okStep, ignore: okStep, restore: okStep };

  it("shows the address, the requests with the robots' share, when it was last asked and whether a redirect covers it", () => {
    const out = html(createElement(NotFoundTable, { rows, timeZone: "UTC", actions, canWrite: true }));
    expect(out).toContain("<caption");
    expect(out).toContain("/collections/shoes");
    expect(out).toContain("40 requests, 12 by robots");
    expect(out).toContain("1 request<");
    expect(out).toContain("5 Oct 2026, 10:00");
    expect(out).toContain(">Yes<");
    expect(out).toContain(">No<");
  });

  it("offers each suggestion as a one-click button, a short form for the others, and Ignore", () => {
    const out = html(createElement(NotFoundTable, { rows, timeZone: "UTC", actions, canWrite: true }));
    expect(out).toContain(">Redirect to /category/shoes<");
    expect(out).toContain(">Redirect to /p/shoe<");
    expect(out).toContain("Category: Shoes");
    expect(out).toContain("Another target …");
    expect(out).toContain(">Redirect …<");
    expect(out).toContain(">Ignore<");
  });

  it("offers nothing to change to a member who may only read, and nothing for an address already covered", () => {
    const readOnly = html(createElement(NotFoundTable, { rows, timeZone: "UTC", actions, canWrite: false }));
    expect(readOnly).not.toContain("Redirect to /category/shoes");
    expect(readOnly).not.toContain(">Ignore<");
    const writer = html(createElement(NotFoundTable, { rows: [rows[2]], timeZone: "UTC", actions, canWrite: true }));
    expect(writer).not.toContain(">Ignore<");
    expect(writer).not.toContain("Redirect …");
  });

  it("marks a hidden address and offers to restore it", () => {
    const out = html(createElement(NotFoundTable, { rows: [{ ...rows[1], ignored: true }], timeZone: "UTC", actions, canWrite: true }));
    expect(out).toContain("Hidden");
    expect(out).toContain(">Restore<");
  });
});
