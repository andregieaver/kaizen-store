import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

/**
 * What the server side of the VAT, OSS and IOSS reports never does (D161, `docs/wave-1c-reports.md` 3.5 and 6.4), held by reading the source: a
 * shopper's page, the sitemap, `llms.txt`, a feed, the chat agent, search, recommendations or an integration never reaches a report; the reports
 * open a document only through `commerce.tax_document_groups()` (and the reconciliation, the one module that names the invoices' table); the ECB is
 * asked only by its own module, which asks only the ECB's constant addresses; and nothing here sets a cookie or uses browser storage.
 */

const root = path.resolve(__dirname, "../..");
const walk = (dir: string, out: string[] = []): string[] => {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) && !/-fixture\.tsx?$/.test(name) && !name.endsWith(".d.ts")) out.push(full);
  }
  return out;
};
const sources = walk(path.join(root, "src")).map((file) => ({ file: path.relative(root, file).split(path.sep).join("/"), text: readFileSync(file, "utf8") }));
/** Source without its comments (they say what the code never does). */
const strip = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`\\])\/\/.*$/gm, "$1");
const text = (file: string) => strip(sources.find((s) => s.file === file)!.text);

/** The server modules of the unit, and the pure libraries they and the admin read. */
const SERVER = ["tax-reports", "tax-reconciliation", "tax-report-exports", "ecb-rates", "ecb-fetch", "tax-rate-overrides"].map((m) => `src/server/${m}.ts`);
const LIBS = ["tax-report", "tax-classes", "tax-periods", "tax-csv", "tax-reconciliation", "oss-return", "ecb-history"].map((m) => `src/lib/${m}.ts`);
const NAMES = [...SERVER, ...LIBS].map((f) => path.basename(f, ".ts"));

const imports = (module: string) => new RegExp(`from "(@/(server|lib)/|\\./)${module}"`);

describe("who reaches a report", () => {
  it("is the admin, the AI manager's tools, the control center, the daily job and the unit's own modules: never a shopper, the sitemap, a feed, the chat agent, search, recommendations or an integration", () => {
    const forbidden = /^src\/(app\/(s\/|sitemap|llms|feeds?|robots)|app\/\(platform\)|server\/(chat|knowledge|search|integrations?|feed|recommend|stripe|checkout|cart|orders|shopper|slack))/;
    const found = sources.filter(({ file, text: body }) => forbidden.test(file) && NAMES.some((name) => imports(name).test(body)));
    expect(found.map((s) => s.file)).toEqual([]);
  });

  it("is opened for the rates only by the daily job's route among the app's routes", () => {
    const routes = sources.filter(({ file, text: body }) => file.startsWith("src/app/api/") && /@\/server\/ecb-rates|@\/server\/tax-report/.test(body));
    expect(routes.map((s) => s.file)).toEqual(["src/app/api/cron/subscription-reminders/route.ts"]);
  });
});

describe("how a document is opened", () => {
  it("is only through the one database function, called only by `tax-reports.ts`, and no server module of the unit but the reconciliation names a document table", () => {
    const callers = sources.filter(({ file, text: body }) => !file.startsWith("src/db/") && /tax_document_groups/.test(strip(body))).map((s) => s.file);
    expect(callers).toEqual(["src/server/tax-reports.ts"]);
    for (const file of SERVER.filter((f) => f !== "src/server/tax-reconciliation.ts")) expect(text(file), file).not.toMatch(/commerce\.(invoices|credit_notes)\b/);
  });

  it("reads nothing of a snapshot in TypeScript: no snapshot path, and no buyer field, in any module of the unit", () => {
    for (const file of [...SERVER, ...LIBS]) {
      expect(text(file), file).not.toMatch(/\bsnapshot\b\s*(->|\.|\[)|vatNumber|organisationNumber|deliveryPlace|billing_address|shipping_address|\bemail\b\s*[:=]/);
    }
  });

  it("reads only the aggregate columns of an order and an invoice in the reconciliation: its order, supply date, VAT, currency and its order's payment status", () => {
    const body = text("src/server/tax-reconciliation.ts");
    const selected = [...body.matchAll(/\bi\.(\w+)/g)].map((m) => m[1]);
    expect([...new Set(selected)].sort()).toEqual(["currency", "id", "order_id", "store_id", "supply_date", "tax_minor"]);
  });

  it("puts the store id on every query of a store's table in the modules that read them", () => {
    for (const file of ["src/server/tax-reconciliation.ts", "src/server/tax-report-exports.ts", "src/server/tax-rate-overrides.ts"]) {
      const body = text(file);
      const queries = [...body.matchAll(/from commerce\.(\w+)[\s\S]{0,400}?(?=`)/g)].filter((m) => !/^(accounts|countries)$/.test(m[1]));
      for (const q of queries) expect(q[0], `${file}: ${q[1]}`).toMatch(/store_id/);
    }
  });
});

describe("what goes out and what is set", () => {
  it("asks the ECB through one module only, from constant addresses: no other module of the unit calls `fetch` and none builds an address", () => {
    for (const file of [...SERVER, ...LIBS].filter((f) => f !== "src/server/ecb-fetch.ts")) {
      expect(text(file), file).not.toMatch(/\bfetch\(/);
    }
    const body = text("src/server/ecb-fetch.ts");
    expect(body.match(/\bfetch\(/g)).toHaveLength(1);
    expect(body).not.toMatch(/https?:\/\//);
    expect(body).toContain("isEcbUrl(url)");
  });

  it("sets no cookie and uses no browser storage, names no provider or model and takes no credential from the environment", () => {
    for (const file of [...SERVER, ...LIBS]) {
      expect(text(file), file).not.toMatch(/\bcookies\(\)|localStorage|sessionStorage|document\.cookie|Set-Cookie/);
      expect(text(file), file).not.toMatch(/\b(gpt-|claude-|gemini|openai)\b/i);
      expect(text(file), file).not.toMatch(/process\.env/);
    }
  });

  it("is server-only in every server module", () => {
    for (const file of SERVER) expect(text(file), file).toMatch(/^import "server-only";/m);
  });

  it("never lets a report or an export be written by anything but its own functions: no source updates or deletes an export or a stored rate", () => {
    const changing = sources.filter(({ file, text: body }) => !file.startsWith("src/db/") && /(update|delete\s+from)\s+commerce\.(ecb_reference_rates|tax_report_exports)\b/i.test(body));
    expect(changing.map((s) => s.file)).toEqual([]);
    const writers = sources.filter(({ file, text: body }) => !file.startsWith("src/db/") && /insert\s+into\s+commerce\.(ecb_reference_rates|tax_report_exports|tax_rate_overrides)\b/i.test(body)).map((s) => s.file).sort();
    expect(writers).toEqual(["src/server/ecb-rates.ts", "src/server/tax-rate-overrides.ts", "src/server/tax-report-exports.ts"]);
  });
});
