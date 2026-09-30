// Imports one person's Work data from Kaizen Life into a store (docs/work.md WP15).
//
// It never connects to a database. It reads a JSON export of one Life space (read-only SELECTs made
// by whoever runs this), converts it with src/lib/work-import.ts, writes ONE SQL file (a single
// transaction; run it yourself with `psql -1 -f` or as one query) and prints the dry-run
// reconciliation report: per invoice Life's total against the store's, per line rounding
// differences, and everything altered, assumed or left out with the reason.
//
//   node scripts/import-life-work.mjs <life-export.json> <store-slug> [options]
//
//   --out <file>            where to write the SQL (default ./import-<slug>.sql)
//   --report <file>         also write the report to a file
//   --store-id <uuid>       the store's id (default: store_snapshot.store_id of the export)
//   --account-email <mail>  the store member the time entries and rows are made by
//                           (default: the owner in store_snapshot.members)
//   --allow-skips           exit 0 even when a row could not be imported faithfully
//
// Exit code: 0 when everything was converted faithfully (or --allow-skips), 2 when something was
// left out, 1 on bad arguments. Nothing is ever written to Life, no email is sent, and the SQL takes
// no number from the store's invoice series and queues no integration event.
import { readFile, writeFile } from "node:fs/promises";

import { DEFAULT_OPTIONS, planImport, renderReport, renderSql } from "../src/lib/work-import.ts";

function fail(message) {
  console.error(message);
  process.exit(1);
}

const args = process.argv.slice(2);
const flags = new Map();
const positional = [];
for (let i = 0; i < args.length; i += 1) {
  if (args[i] === "--allow-skips") flags.set("allow-skips", true);
  else if (args[i].startsWith("--")) {
    if (i + 1 >= args.length) fail(`${args[i]} needs a value`);
    flags.set(args[i].slice(2), args[i + 1]);
    i += 1;
  } else positional.push(args[i]);
}
const [exportPath, slug] = positional;
if (!exportPath || !slug) fail("usage: node scripts/import-life-work.mjs <life-export.json> <store-slug> [--out file.sql] [--report file.txt]");

const life = JSON.parse(await readFile(exportPath, "utf8"));
const snapshot = life.store_snapshot ?? {};
const storeId = flags.get("store-id") ?? (snapshot.slug === slug ? snapshot.store_id : undefined);
if (!storeId) fail(`no store id: pass --store-id, or export store_snapshot for the slug ${slug}`);
const owner = (snapshot.members ?? []).find((m) => m.role === "owner");
const accountEmail = flags.get("account-email") ?? owner?.email;
if (!accountEmail) fail("no member to make the rows by: pass --account-email");

const plan = planImport(life, {
  ...DEFAULT_OPTIONS,
  timeZone: snapshot.time_zone ?? DEFAULT_OPTIONS.timeZone,
  storeId,
  storeSlug: slug,
  accountEmail,
});

// What the seller snapshot on imported invoices will lack, judged from the store as it was exported
// (the SQL reads the store's own details and Work settings when it runs, so fill them in first).
const seller = [];
if (!snapshot.legal_name) seller.push("legal name");
if (!snapshot.organisation_number) seller.push("organisation number");
if (!snapshot.postal_address) seller.push("postal address");
const settings = snapshot.work_settings;
if (!settings) seller.push("Work settings (none saved yet: VAT number, bank account, payment note, footer)");
else {
  if (settings.vat_registered !== false && !settings.vat_number) seller.push("VAT number");
  if (!settings.bank_account) seller.push("bank account");
}

const sql = renderSql(plan);
const out = flags.get("out") ?? `import-${slug}.sql`;
await writeFile(out, sql, "utf8");

let report = renderReport(plan, { sqlFile: out });
if (plan.invoices.some((i) => i.imported)) {
  report += [
    "",
    "SELLER ON THE IMPORTED INVOICES",
    `  Snapshot from the store's details and Work settings at run time. As exported (${snapshot.read_from ?? "date unknown"}):`,
    `  legal name ${snapshot.legal_name ?? "-"}, organisation number ${snapshot.organisation_number ?? "-"}, address ${snapshot.postal_address ?? "-"}, country ${snapshot.country ?? "-"}, email ${snapshot.contact_email ?? "-"}.`,
    seller.length === 0
      ? "  Complete."
      : `  MISSING: ${seller.join("; ")}. Imported invoices freeze whatever the store has when the SQL runs and cannot be changed afterwards: save the Work settings first for a complete seller.`,
    "  The buyer is the client as imported: name and billing email only (no address, VAT or organisation number: Life kept none).",
    "",
  ].join("\n");
}
if (flags.has("report")) await writeFile(flags.get("report"), report, "utf8");
process.stdout.write(report);
console.error(`\nwrote ${out} (${sql.length} bytes)`);
if (plan.skipped.length > 0 && !flags.has("allow-skips")) process.exit(2);
