import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  EMAIL_KINDS,
  EMAIL_KIND_PREFIXES,
  EVIDENCE_EMAIL_KINDS,
  EXPORT_SECTIONS,
  NOT_PERSONAL,
  PERSONAL_DATA,
  detectorsOf,
  emailClassOf,
  matchedByColumns,
  registerProblems,
} from "./personal-data";
import { RETENTION_KINDS, RETENTION_SEED } from "./retention";

describe("the register's own rules", () => {
  it("has no table twice, and none in both lists", () => {
    const names = PERSONAL_DATA.map((e) => e.table);
    expect(names.filter((n, i) => names.indexOf(n) !== i)).toEqual([]);
    expect(names.filter((n) => n in NOT_PERSONAL)).toEqual([]);
  });

  it("feeds every section of the export from at least one entry, and names only sections that exist", () => {
    const fed = new Set<string>();
    for (const e of PERSONAL_DATA) {
      if (e.export) fed.add(e.export);
      for (const s of e.also ?? []) fed.add(s);
      for (const s of [e.export, ...(e.also ?? [])]) if (s) expect(EXPORT_SECTIONS as readonly string[], `${e.table} -> ${s}`).toContain(s);
    }
    expect(EXPORT_SECTIONS.filter((s) => !fed.has(s))).toEqual([]);
  });

  it("gives every shopper entry that links to a person an erasure other than none", () => {
    for (const e of PERSONAL_DATA.filter((x) => x.subject === "shopper" && x.link.via !== "none")) {
      expect([e.table, e.erasure !== "none"]).toEqual([e.table, true]);
    }
  });

  it("gives every entry a reason, a restrict a retention rule that is seeded, and a personal column unless it holds none", () => {
    for (const e of PERSONAL_DATA) {
      expect([e.table, e.reason.trim().length > 10]).toEqual([e.table, true]);
      if (e.erasure === "restrict") {
        expect(e.until, e.table).toBeDefined();
        expect(RETENTION_KINDS as readonly string[], e.table).toContain(e.until);
        expect(RETENTION_SEED.some((r) => r.kind === e.until && r.country === null), e.table).toBe(true);
      }
      if (e.until) expect(RETENTION_KINDS as readonly string[], e.table).toContain(e.until);
      if (e.subject !== "none" && e.table !== "search_clicks" && e.table !== "chat_usage" && e.table !== "product_views") expect(e.personal.length, e.table).toBeGreaterThan(0);
    }
  });

  it("states a reason for every table it says is not personal", () => {
    for (const [table, reason] of Object.entries(NOT_PERSONAL)) expect([table, reason.length > 10]).toEqual([table, true]);
  });

  it("restricts exactly what bookkeeping law keeps, and nothing a person could ask to have deleted", () => {
    const restricted = PERSONAL_DATA.filter((e) => e.erasure === "restrict").map((e) => e.table);
    expect(restricted.sort()).toEqual(["credit_notes", "invoices", "orders", "returns", "storage:documents", "vat_checks", "withdrawal_requests"]);
    expect(PERSONAL_DATA.find((e) => e.table === "email_opt_outs")?.erasure).toBe("keep");
    expect(PERSONAL_DATA.find((e) => e.table === "customers")?.erasure).toBe("delete");
  });
});

describe("the detectors", () => {
  it("match a table by the names of its columns", () => {
    expect(matchedByColumns(["id", "customer_id", "body"])).toEqual(["A", "C"]);
    expect(matchedByColumns(["id", "store_id", "created_at"])).toEqual([]);
    expect(matchedByColumns(["contact_email"])).toEqual(["A"]);
    expect(matchedByColumns(["billing_phone"])).toEqual(["A"]);
    expect(matchedByColumns(["email_verified_at"])).toEqual(["A"]);
    expect(matchedByColumns(["address_line"])).toEqual(["A"]);
    expect(matchedByColumns(["ip_address"])).toEqual(["A"]);
    expect(matchedByColumns(["payload"])).toEqual(["C"]);
    expect(matchedByColumns(["emailing"])).toEqual([]);
  });

  it("match a table by a foreign key to a shopper anchor, and never by one to accounts", () => {
    expect(detectorsOf(["id", "store_id"], ["orders"])).toEqual(["B"]);
    expect(detectorsOf(["id", "created_by"], ["accounts", "stores"])).toEqual([]);
    expect(detectorsOf(["customer_id", "note"], ["customers"])).toEqual(["A", "B", "C"]);
  });

  it("fail for a new table that is not in the register (the heart of the unit)", () => {
    const tables = {
      zz_reviews: { columns: ["store_id", "customer_id", "body"], detectors: detectorsOf(["store_id", "customer_id", "body"], ["customers"]) },
      zz_notes: { columns: ["store_id", "note"], detectors: detectorsOf(["store_id", "note"], []) },
      zz_counters: { columns: ["store_id", "count"], detectors: detectorsOf(["store_id", "count"], []) },
      orders: { columns: ["id", "email", "billing_address", "shipping_address", "company_name", "organisation_number", "customer_id", "vat_treatment", "delivery"], detectors: ["A"] as const },
    } as Parameters<typeof registerProblems>[0];
    const problems = registerProblems(tables).filter((p) => p.table.startsWith("zz_"));
    expect(problems.map((p) => p.table).sort()).toEqual(["zz_notes", "zz_reviews"]);
  });

  it("fail for an entry whose table is gone or whose personal column does not exist", () => {
    const problems = registerProblems({ orders: { columns: ["id"], detectors: [] } });
    expect(problems.some((p) => p.table === "orders" && p.problem.includes("does not exist"))).toBe(true);
    expect(problems.some((p) => p.table === "customers" && p.problem.includes("not a table"))).toBe(true);
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------
// Every kind passed to sendEmail() is classified
// ---------------------------------------------------------------------------------------------------------------------------------

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) return sourceFiles(p);
    return /\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [p] : [];
  });
}

/** Kinds written as `kind: "x.y"`, `const kind = c ? "a" : "b"` or `kind: \`prefix.${...}\`` in a module that sends email. Compared operands are skipped. */
function emailKindsInSource(): { literals: Set<string>; prefixes: Set<string> } {
  const literals = new Set<string>();
  const prefixes = new Set<string>();
  for (const file of sourceFiles(path.join(process.cwd(), "src"))) {
    const text = readFileSync(file, "utf8");
    if (!/sendEmail\(|sendBookingEmail|sendWorkEmail|from "\.\/email"/.test(text) || !/\bsendEmail\b/.test(text)) continue;
    for (const m of text.matchAll(/\bkind\s*[:=]\s*([^;\n]*)/g)) {
      const expr = m[1].replace(/(===?|!==?)\s*"[^"]*"/g, "");
      for (const lit of expr.matchAll(/"([a-z][a-z_]*(?:[._][a-z_]+)+)"/g)) literals.add(lit[1]);
      for (const tpl of expr.matchAll(/`([a-z][a-z_.]*?)\$\{/g)) prefixes.add(tpl[1]);
    }
    for (const m of text.matchAll(/kind:\s*"([a-z_]+\.[a-z_]+)"\s*\|\s*"([a-z_]+\.[a-z_]+)"/g)) {
      literals.add(m[1]);
      literals.add(m[2]);
    }
  }
  return { literals, prefixes };
}

describe("every kind of email is classified", () => {
  // Strings after `kind:` in a sending module that are not kinds of email (they are order event types written beside the send).
  const NOT_EMAIL_KINDS = new Set(["no_show", "invoice.emailed", "credit_note.emailed"]);
  const { literals, prefixes } = emailKindsInSource();

  it("has a class for every literal kind found in the sending modules", () => {
    const missing = [...literals].filter((k) => !NOT_EMAIL_KINDS.has(k) && emailClassOf(k) === null);
    expect(missing.sort()).toEqual([]);
    expect(literals.size).toBeGreaterThan(15);
  });

  it("has a prefix class for every kind built from a prefix", () => {
    const missing = [...prefixes].filter((p) => !Object.keys(EMAIL_KIND_PREFIXES).some((q) => p.startsWith(q) || q.startsWith(p)));
    expect(missing.sort()).toEqual([]);
  });

  it("keeps the withdrawal acknowledgement as the one evidence kind, kept with its order", () => {
    expect(EVIDENCE_EMAIL_KINDS).toEqual(["return.acknowledgement"]);
  });

  it("classifies every kind this unit sends, in the same four classes", () => {
    for (const k of ["privacy.erased", "privacy.extended", "privacy.refused", "privacy.owners_notice", "privacy.due", "privacy.overdue"]) expect(EMAIL_KINDS[k], k).toBeDefined();
    for (const c of Object.values(EMAIL_KINDS)) expect(["shopper", "staff", "security", "evidence"]).toContain(c);
    expect(emailClassOf("subscription.paused")).toBe("shopper");
    expect(emailClassOf("booking.staff_cancelled")).toBe("staff");
    expect(emailClassOf("account.code")).toBe("security");
    expect(emailClassOf("something.new")).toBeNull();
  });
});

describe("the detectors see a person's name or postcode alone (review)", () => {
  it("matches *_name columns except those known to name a thing, and postcode and birth-date columns", () => {
    for (const col of ["reviewer_name", "author_name", "recipient_name", "customer_name", "postal_code", "zip", "date_of_birth"]) {
      expect([col, matchedByColumns(["id", "store_id", col])]).toEqual([col, ["A"]]);
    }
    expect(matchedByColumns(["id", "store_id", "file_name"])).toEqual([]);
    expect(matchedByColumns(["id", "total_minor", "title"])).toEqual([]);
  });
});
