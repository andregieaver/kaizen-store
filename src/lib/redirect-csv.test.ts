import { describe, expect, it } from "vitest";

import { parseCsv, writeCsv } from "./csv";
import { IMPORT_MAX_BYTES, REDIRECT_IMPORT_MAX_ROWS } from "./data-limits";
import { ACCEPTED_NAMES, REDIRECT_EXPORT_COLUMNS, linesOfRecords, problemRows, readRedirectFile, redirectCsv, redirectRows, type ExportRedirect } from "./redirect-csv";
import { finding } from "./data-job";

const bytes = (text: string) => new TextEncoder().encode(text);
const read = (text: string | Uint8Array) => {
  const result = readRedirectFile(typeof text === "string" ? bytes(text) : text);
  if (!result.ok) throw new Error(`refused: ${result.problems.join(" | ")}`);
  return result;
};
const refused = (text: string | Uint8Array) => {
  const result = readRedirectFile(typeof text === "string" ? bytes(text) : text);
  return result.ok ? null : result.problems;
};

describe("reading a redirect file", () => {
  it("reads Shopify's two headings, with the row of each line (the header is row 1)", () => {
    const file = read("Redirect from,Redirect to\r\n/collections/old,/category/new\r\n/products/x,/p/y\r\n");
    expect(file.lines).toEqual([
      { row: 2, from: "/collections/old", to: "/category/new" },
      { row: 3, from: "/products/x", to: "/p/y" },
    ]);
    expect(file.delimiter).toBe(",");
    expect(file.findings).toEqual([]);
  });

  it.each([
    ["from,to"],
    ["source,target"],
    ["Old URL,New URL"],
    ["path,destination"],
    ["REDIRECT_FROM,redirect-to"],
    ["  Redirect  From  ,  Redirect To "],
    ["To,From"],
  ])("knows the heading %s", (header) => {
    const swapped = header.toLowerCase().startsWith("to");
    const file = read(`${header}\n/a,/b\n`);
    expect(file.lines).toEqual([swapped ? { row: 2, from: "/b", to: "/a" } : { row: 2, from: "/a", to: "/b" }]);
  });

  it("finds the delimiter and the encoding: semicolons, tabs, a byte order mark, UTF-16 and Windows-1252", () => {
    expect(read("Redirect from;Redirect to\n/a;/b\n").lines).toEqual([{ row: 2, from: "/a", to: "/b" }]);
    expect(read("Redirect from\tRedirect to\n/a\t/b\n").delimiter).toBe("\t");
    const bom = new Uint8Array([0xef, 0xbb, 0xbf, ...bytes("Redirect from,Redirect to\n/å,/b\n")]);
    expect(read(bom).lines[0].from).toBe("/å");
    // UTF-16 little endian with a byte order mark.
    const utf16 = new Uint8Array([0xff, 0xfe, ...[...("Redirect from,Redirect to\n/ø,/b\n")].flatMap((c) => [c.charCodeAt(0) & 0xff, c.charCodeAt(0) >> 8])]);
    expect(read(utf16)).toMatchObject({ encoding: "utf-16le", lines: [{ from: "/ø", to: "/b" }] });
    // Windows-1252: Excel in Norwegian saves a plain CSV so; `å` is 0xE5. It is read, and said so.
    const latin = new Uint8Array([...bytes("Redirect from;Redirect to\n/"), 0xe5, ...bytes(";/b\n")]);
    const file = read(latin);
    expect(file.lines[0].from).toBe("/å");
    expect(file.findings.map((f) => f.finding.code)).toEqual(["file.encoding_assumed", "file.delimiter"]);
  });

  it("ignores extra columns with an information finding each (our own export's, or any)", () => {
    const file = read("Redirect from,Redirect to,type,created,used,last_used,note\n/a,/b,manual,2026-10-01,3,2026-10-02,hi\n");
    expect(file.lines).toEqual([{ row: 2, from: "/a", to: "/b" }]);
    expect(file.ignored).toEqual(["type", "created", "used", "last_used", "note"]);
    expect(file.findings.filter((f) => f.finding.code === "column.ignored")).toHaveLength(5);
    expect(file.findings.every((f) => f.finding.severity === "info")).toBe(true);
  });

  it("drops blank lines and lines with neither cell, keeps a line with one (the plan says which is missing)", () => {
    const file = read("Redirect from,Redirect to\n\n/a,/b\n,\n/c,\n,/d\n");
    // A row's number counts records (a blank line is no record), as the product import's do.
    expect(file.lines).toEqual([
      { row: 2, from: "/a", to: "/b" },
      { row: 4, from: "/c", to: "" },
      { row: 5, from: "", to: "/d" },
    ]);
  });

  it("reads quoted cells, and undoes the formula escape of an exported cell", () => {
    const file = read(`Redirect from,Redirect to\n"/a,b","/c ""d"""\n"'=1+1",/x\n`);
    expect(file.lines).toEqual([
      { row: 2, from: "/a,b", to: '/c "d"' },
      { row: 3, from: "=1+1", to: "/x" },
    ]);
  });

  it("warns about a row with another number of cells, the first 50 only", () => {
    const rows = Array.from({ length: 60 }, (_, i) => `/a${i},/b${i},extra`).join("\n");
    const file = read(`Redirect from,Redirect to\n${rows}\n`);
    expect(file.findings.filter((f) => f.finding.code === "file.ragged_row")).toHaveLength(50);
    expect(file.findings.find((f) => f.finding.code === "file.ragged_row")?.rows).toEqual([2]);
  });

  it("refuses a file that is empty, not a redirect file, too big, too long or ends inside a quote", () => {
    expect(refused(new Uint8Array())).toEqual([finding("file.empty").text]);
    expect(refused("\n\n")?.[0]).toBe(finding("file.empty").text);
    const names = refused("title,price\nA,1\n");
    expect(names?.[0]).toBe(finding("file.not_redirects", { names: ACCEPTED_NAMES }).text);
    expect(names?.[0]).toContain('"Redirect from" and "Redirect to"');
    expect(refused("Redirect from\n/a\n")?.[0]).toMatch(/not a redirect file/);
    expect(refused("/a,/b\n/c,/d\n")?.[0]).toMatch(/not a redirect file/);
    expect(refused(new Uint8Array(IMPORT_MAX_BYTES + 1))?.[0]).toBe(finding("file.too_large", { max: 15 }).text);
    expect(refused('Redirect from,Redirect to\n"/a,/b\n')?.[0]).toMatch(/quoted cell/);
    const many = `Redirect from,Redirect to\n${Array.from({ length: REDIRECT_IMPORT_MAX_ROWS + 1 }, (_, i) => `/a${i},/b`).join("\n")}\n`;
    expect(refused(many)?.[0]).toBe(finding("file.too_many_rows", { n: REDIRECT_IMPORT_MAX_ROWS + 1, max: REDIRECT_IMPORT_MAX_ROWS }).text);
    const exactly = `Redirect from,Redirect to\n${Array.from({ length: REDIRECT_IMPORT_MAX_ROWS }, (_, i) => `/a${i},/b`).join("\n")}\n`;
    expect(read(exactly).lines).toHaveLength(REDIRECT_IMPORT_MAX_ROWS);
  });

  it("reads records the same way", () => {
    expect(linesOfRecords([["Redirect from", "Redirect to"], ["/a", "/b"], ["", ""]])).toEqual([{ row: 2, from: "/a", to: "/b" }]);
    expect(linesOfRecords([["x", "y"], ["/a", "/b"]])).toEqual([]);
  });
});

describe("writing a redirect file", () => {
  const at = new Date("2026-10-01T12:00:00Z");
  const rows: ExportRedirect[] = [
    { kind: "manual", source: "/collections/old", target: "/category/new", createdAt: at, hits: 12, lastHitAt: new Date("2026-10-04T08:00:00Z") },
    { kind: "product", source: "/p/old-cup", target: "/p/new-cup", createdAt: at, hits: 0, lastHitAt: null },
    { kind: "category", source: "/category/gone", target: null, createdAt: at, hits: 3, lastHitAt: at },
  ];

  it("has Shopify's two columns first, then type, created, used and last_used", () => {
    expect(REDIRECT_EXPORT_COLUMNS).toEqual(["Redirect from", "Redirect to", "type", "created", "used", "last_used"]);
    expect(redirectRows(rows)).toEqual([
      ["Redirect from", "Redirect to", "type", "created", "used", "last_used"],
      ["/collections/old", "/category/new", "manual", "2026-10-01", 12, "2026-10-04"],
      ["/p/old-cup", "/p/new-cup", "product", "2026-10-01", 0, null],
      ["/category/gone", null, "category", "2026-10-01", 3, "2026-10-01"],
    ]);
    expect(redirectCsv(rows)).toBe(
      "Redirect from,Redirect to,type,created,used,last_used\r\n/collections/old,/category/new,manual,2026-10-01,12,2026-10-04\r\n/p/old-cup,/p/new-cup,product,2026-10-01,0,\r\n/category/gone,,category,2026-10-01,3,2026-10-01\r\n",
    );
  });

  it("writes the Excel (Nordic) file with a semicolon and a byte order mark", () => {
    const text = redirectCsv(rows.slice(0, 1), "excel_nordic");
    expect(text.startsWith("﻿Redirect from;Redirect to;type")).toBe(true);
  });

  it("escapes a cell that a spreadsheet would run as a formula, and reads it back as it was", () => {
    const risky: ExportRedirect = { kind: "manual", source: "/-old", target: "/=cmd", createdAt: at, hits: 0, lastHitAt: null };
    // Addresses start with a slash, so they are not formulas; a cell that was one (a path typed without its slash) is escaped all the same.
    const text = writeCsv([["Redirect from", "Redirect to"], ["-1+1", "@SUM(A1)"], [risky.source, risky.target]]);
    expect(text).toContain("'-1+1,'@SUM(A1)");
    const file = read(text);
    expect(file.lines).toEqual([
      { row: 2, from: "-1+1", to: "@SUM(A1)" },
      { row: 3, from: "/-old", to: "/=cmd" },
    ]);
  });

  it("round-trips: the rows of an export read back into the same lines", () => {
    const manual = rows.filter((r) => r.kind === "manual");
    const file = read(redirectCsv(manual));
    expect(file.lines).toEqual([{ row: 2, from: "/collections/old", to: "/category/new" }]);
    for (const dialect of ["standard", "excel_nordic"] as const) {
      const odd: ExportRedirect = { ...manual[0], source: "/a;b,c", target: '/d "e"\nf' };
      expect(read(redirectCsv([odd], dialect)).lines).toEqual([{ row: 2, from: "/a;b,c", to: '/d "e"\nf' }]);
    }
    expect(parseCsv(redirectCsv(rows)).rows).toHaveLength(4);
  });

  it("writes the problems of a check as a file, one row for each finding", () => {
    const rowsOut = problemRows([
      { rows: [3], from: "/a", to: "/b", messages: [finding("target.not_found", { address: "/b" }), finding("source.live", { address: "/a" })] },
      { rows: [7], from: "", to: "", messages: [finding("source.missing")] },
    ]);
    expect(rowsOut[0]).toEqual(["row", "redirect_from", "redirect_to", "severity", "code", "message"]);
    expect(rowsOut).toHaveLength(4);
    expect(rowsOut[1].slice(0, 5)).toEqual([3, "/a", "/b", "warning", "target.not_found"]);
    expect(rowsOut[3].slice(0, 5)).toEqual([7, "", "", "error", "source.missing"]);
  });
});
