import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

/**
 * What the shopper's side of the documents (D159, `docs/wave-1b-invoices.md` 2.2 point 10 and 3.5) never does: set a cookie or use storage (a
 * document is reached by its token alone, so `KNOWN_COOKIES` stays as it is), call out to anything (the PDF renderer must be able to refuse every
 * request), or draw a document from live data. The files are the components, the hosted page and its PDF route.
 */
const root = path.resolve(__dirname, "../../..");
const FILES = [
  "src/components/documents/order-document-view.tsx",
  "src/components/documents/order-documents.tsx",
  "src/components/documents/document-print-button.tsx",
  "src/app/s/[store]/[market]/account/documents/[token]/page.tsx",
  "src/app/s/[store]/[market]/account/documents/[token]/pdf/route.ts",
];
const source = (file: string) => readFileSync(path.join(root, file), "utf8");

describe("the shopper's documents", () => {
  it("set no cookie and use no storage", () => {
    for (const file of FILES) expect(source(file), file).not.toMatch(/\bcookies\(\)|localStorage|sessionStorage|document\.cookie|Set-Cookie|indexedDB/);
  });

  it("fetch nothing and load nothing from elsewhere", () => {
    for (const file of FILES) {
      const text = source(file);
      expect(text, file).not.toMatch(/\bfetch\(|XMLHttpRequest|<img|<link|<script|@import|url\(/);
    }
  });

  it("draw a document only from its snapshot, never from a table or live order data", () => {
    for (const file of FILES.filter((f) => /order-document-view|order-documents|document-print-button/.test(f))) {
      expect(source(file), file).not.toMatch(/commerce\.|@\/db|@\/server\//);
    }
  });

  it("are not indexed: the hosted page says so, and so does the PDF's answer", () => {
    expect(source(FILES[3])).toMatch(/robots:\s*\{\s*index:\s*false/);
    expect(source(FILES[3])).toMatch(/referrer:\s*"no-referrer"/);
    expect(source(FILES[4])).toMatch(/"X-Robots-Tag":\s*"noindex"/);
    expect(source(FILES[4])).toMatch(/"Cache-Control":\s*"no-store"/);
  });

  it("find a document through the store the address names and its token, and answer one 404 for everything else", () => {
    const page = source(FILES[3]);
    const route = source(FILES[4]);
    expect(page).toMatch(/findDocumentByToken\(store\.id, token\)/);
    expect(route).toMatch(/findDocumentByToken\(shop\.store\.id, token\)/);
    expect(page).toMatch(/isDocumentToken\(token\)/);
    expect(route).toMatch(/isDocumentToken\(token\)/);
    // Chromium is imported by the PDF route only (a source scan of the whole unit holds the rest, `document-readers.test.ts`).
    expect(page).not.toMatch(/from "@\/server\/(invoice-pdf|browser)"/);
  });
});
