import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Who reads and writes invoices and credit notes (D159, `docs/wave-1b-invoices.md` 3.3, 3.5, 4.9). A document holds a buyer's name, address,
 * email, company and VAT number, so only the modules below read `commerce.invoices` or `commerce.credit_notes`; a module that does and is not
 * listed is new, and must be looked at (is a shopper or the public reaching it? does it show a buyer's field to someone it should not?) before
 * it is added. Nothing but the database's issuing functions writes a document: no source under `src/` inserts into either table. Chromium is
 * loaded only by `invoice-pdf.ts` and the routes that render, which are each in `outputFileTracingIncludes`.
 */

const files = (dir: string, out: string[] = []): string[] => {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) files(full, out);
    // Fixtures that tests build their rows with (`*-fixture.ts`, imported by tests only) are not the app.
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) && !/-fixture\.tsx?$/.test(name) && !name.endsWith(".d.ts")) out.push(full);
  }
  return out;
};

const root = path.resolve(__dirname, "../..");
const sources = files(path.join(root, "src")).map((file) => ({ file: path.relative(root, file).split(path.sep).join("/"), text: readFileSync(file, "utf8") }));
const readers = (pattern: RegExp) =>
  sources
    .filter(({ file, text }) => file !== "src/db/schema.ts" && pattern.test(text))
    .map(({ file }) => file)
    .sort();

describe("who reads invoices and credit notes", () => {
  it("is a short list of server modules, none of which is a shopper's page, an integration, the chat agent or a feed", () => {
    expect(readers(/commerce\.(invoices|credit_notes)\b/)).toEqual(
      [
        // The lists, one document, a document by its token, an order's documents, the queue and the checkup.
        "src/server/invoices.ts",
        // The series' state, to lock the prefix once a document is issued.
        "src/server/invoice-settings.ts",
        // The accountant's CSV.
        "src/server/invoice-export.ts",
        // The PDF: reads the snapshot, stores the file's path once.
        "src/server/invoice-pdf.ts",
        "src/server/invoice-storage.ts",
        // The shopper's emails: the link and the number, never the buyer's fields.
        "src/server/invoice-emails.ts",
        "src/server/invoice-notices.ts",
        // The job: which stores have something to issue.
        "src/server/invoice-issue.ts",
        // A refund's credit note, to announce it.
        "src/server/stripe-refunds.ts",
        // The VAT report's reconciliation (D161): an invoice's order, supply date, VAT and currency, nothing personal. The reports themselves
        // read documents through `commerce.tax_document_groups()` and name neither table.
        "src/server/tax-reconciliation.ts",
        // A person's own documents in their data file (the snapshot as issued), and the count the erasure preview shows (D162).
        "src/server/privacy-export.ts",
        "src/server/privacy-erasure.ts",
      ].sort(),
    );
  });

  it("never lets a shopper's page, the sitemap, llms.txt, a feed, the chat agent or an integration event read a document", () => {
    const outside = sources.filter(
      ({ file, text }) =>
        /commerce\.(invoices|credit_notes)\b|from "@\/server\/invoices"|from "\.\/invoices"/.test(text) &&
        /^src\/(app\/(sitemap|llms|feeds?|robots)|server\/(chat|knowledge|search|integrations?|feed|recommend|analytics))/.test(file),
    );
    expect(outside.map(({ file }) => file)).toEqual([]);
  });
});

describe("who writes invoices and credit notes", () => {
  it("is the database's issuing functions alone: no source inserts into either table", () => {
    const inserting = sources.filter(({ file, text }) => !file.startsWith("src/db/") && /insert\s+into\s+commerce\.(invoices|credit_notes)\b/i.test(text));
    expect(inserting.map(({ file }) => file)).toEqual([]);
  });

  it("is never deleted or changed from code (the PDF's path, set once by `invoice-pdf.ts`, is the only update)", () => {
    const changing = sources.filter(({ file, text }) => !file.startsWith("src/db/") && /(delete\s+from|update)\s+commerce\.(invoices|credit_notes)\b/i.test(text));
    expect(changing.map(({ file }) => file)).toEqual([]);
    // `invoice-pdf.ts` names the table through a fragment, never a literal `update commerce.invoices`; its update sets the path where it is null.
    const pdf = sources.find(({ file }) => file === "src/server/invoice-pdf.ts")!.text;
    expect(pdf).toMatch(/set pdf_path = \$\{path\}, pdf_sha256 = \$\{sha256\(kept\)\}[\s\S]{0,200}and pdf_path is null/);
  });

  it("numbers a document only through `next_document_number()` inside the issuing functions: no code takes a number of the two series", () => {
    const numbering = sources.filter(({ file, text }) => !file.startsWith("src/db/") && /next_document_number\(/.test(text) && /'(invoice|credit_note)'/.test(text));
    expect(numbering.map(({ file }) => file)).toEqual([]);
  });
});

describe("where Chromium is loaded for documents", () => {
  const importers = (module: RegExp) => sources.filter(({ text }) => module.test(text)).map(({ file }) => file).sort();

  it("is `invoice-pdf.ts` for the renderer, imported only by the routes that render and the job's route", () => {
    expect(importers(/from "(\.\/|@\/server\/)invoice-pdf"/)).toEqual(
      importers(/from "(\.\/|@\/server\/)invoice-pdf"/).filter((file) => /\/pdf\/route\.ts$|^src\/app\/api\/cron\/document-pdfs\/route\.ts$/.test(file)),
    );
  });

  it("is never reached from the emails, the webhook, the five-minute job or the order pages", () => {
    for (const file of ["src/server/invoice-emails.ts", "src/server/invoice-notices.ts", "src/server/invoice-issue.ts", "src/server/stripe-refunds.ts", "src/server/stripe-webhooks.ts", "src/server/shopper-emails.ts", "src/server/return-emails.ts", "src/app/api/cron/cart-reminders/route.ts"]) {
      const text = sources.find((s) => s.file === file)!.text;
      expect(text, file).not.toMatch(/from "(\.\/|@\/server\/)(invoice-pdf|browser|document-html)"/);
    }
  });

  it("is only `browser.ts` that launches it, and the three routes of the unit are in `outputFileTracingIncludes`", () => {
    const config = readFileSync(path.join(root, "next.config.ts"), "utf8");
    for (const glob of ["/s/**/account/documents/**/pdf", "/admin/**/invoices/**/pdf", "/api/cron/document-pdfs"]) expect(config).toContain(`"${glob}": DOCUMENT_PDF_FILES`);
    expect(importers(/launchBrowser\(/).filter((file) => /invoice/.test(file))).toEqual(["src/server/invoice-pdf.ts"]);
  });
});

describe("what the unit's server modules never do", () => {
  const mine = sources.filter(({ file }) => /^src\/server\/(invoice-[a-z-]+|invoices|stripe-refunds|document-html)\.tsx?$/.test(file));

  it("sets no cookie and uses no browser storage: documents are reached by their token alone", () => {
    expect(mine.length).toBeGreaterThanOrEqual(10);
    for (const { file, text } of mine) {
      expect(text, file).not.toMatch(/\bcookies\(\)|localStorage|sessionStorage|document\.cookie|Set-Cookie/);
    }
  });

  it("makes no request to anything but Stripe's API through its own client and the document bucket: no plain `fetch` of an address", () => {
    for (const { file, text } of mine) expect(text, file).not.toMatch(/\bfetch\(/);
  });

  it("names no provider or model, and takes no payment credential from the environment", () => {
    for (const { file, text } of mine) {
      expect(text, file).not.toMatch(/\b(gpt-|claude-|gemini|openai)\b/i);
      expect(text, file).not.toMatch(/STRIPE_SECRET_KEY|process\.env\.STRIPE/);
    }
  });
});

describe("Stripe's own invoice for an order", () => {
  it("is read only where checkout decides to ask for it and where the Payments page and its action set it", () => {
    expect(readers(/orderInvoices|order_invoices/).filter((file) => !/invoice-settings/.test(file))).toEqual(
      ["src/app/admin/(gated)/[store]/settings/payments/page.tsx", "src/app/admin/(gated)/actions.ts", "src/lib/audit.ts", "src/server/checkout.ts", "src/server/settings.ts"].sort(),
    );
    const checkout = sources.find(({ file }) => file === "src/server/checkout.ts")!.text;
    expect(checkout).toMatch(/connection\.orderInvoices\s*&&\s*!kaizenInvoices/);
  });
});
