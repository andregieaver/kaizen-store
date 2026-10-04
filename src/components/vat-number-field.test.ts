import { readFileSync } from "node:fs";

import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { createElement } from "react";

import { vatText } from "@/lib/vat-text";

import { VatNumberField } from "./vat-number-field";
import { VatNotes } from "./vat-notes";

const text = (lang: string) => vatText(lang);
const labels = (lang: string) => ({ label: text(lang).label, help: text(lang).help, check: text(lang).check, checking: text(lang).checking });
const words = (markup: string) => markup.replace(/<!-- -->/g, "").replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/\s+/g, " ").trim();

const field = (over: Partial<Parameters<typeof VatNumberField>[0]> = {}, lang = "en") =>
  renderToString(
    createElement(VatNumberField, { value: "", onChange: () => undefined, onCheck: () => undefined, checking: false, message: null, problem: null, labels: labels(lang), ...over }),
  );

describe("the VAT number field (D157)", () => {
  it("is a labelled input with its help, and a Check button that does not submit the checkout form", () => {
    const markup = field();
    expect(markup).toMatch(/<label[^>]*for="[^"]+"/);
    expect(words(markup)).toContain("VAT number (EU)");
    expect(words(markup)).toContain("If it is valid in the country the goods are sent to, VAT is not charged");
    expect(markup).toContain('type="button"');
    expect(markup).toContain("Check number");
    expect(markup).toContain('name="vatNumber"');
    // The label points at the input, and the answer is described to it.
    const id = /<input id="([^"]+)"/.exec(markup)?.[1];
    expect(id).toBeTruthy();
    expect(markup).toContain(`for="${id}"`);
    expect(markup).toMatch(/aria-describedby="[^"]+ [^"]+"/);
  });

  it("shows what is typed and says it is checking while it asks", () => {
    const markup = field({ value: "DE 123 456 789", checking: true });
    expect(markup).toContain('value="DE 123 456 789"');
    expect(markup).toContain("Checking");
    expect(markup).toMatch(/<button[^>]*disabled/);
  });

  it("announces the answer in a live region, and a problem as an alert", () => {
    const ok = field({ message: { text: "The VAT number was accepted.", tone: "ok" } });
    expect(ok).toMatch(/<p[^>]*role="status"[^>]*aria-live="polite"[^>]*>The VAT number was accepted\./);
    const problem = field({ problem: "Enter a VAT number." });
    expect(problem).toMatch(/<p[^>]*role="alert"[^>]*>Enter a VAT number\./);
    expect(problem).toContain('aria-invalid="true"');
    // A problem replaces the server's sentence rather than sitting beside it.
    const both = field({ problem: "Enter a VAT number.", message: { text: "The VAT number was accepted.", tone: "ok" } });
    expect(words(both)).not.toContain("accepted");
  });

  it("reads in the store's language", () => {
    expect(words(field({}, "nb"))).toContain("Mva-nummer (EU)");
    expect(words(field({}, "sv"))).toContain("Momsnummer (EU)");
    expect(words(field({}, "da"))).toContain("Tjek nummeret");
  });

  it("sets no cookie and uses no storage: the number is on the cart's row", () => {
    for (const file of ["vat-number-field.tsx", "vat-notes.tsx", "checkout-button.tsx", "order-vat.tsx"]) {
      const source = readFileSync(new URL(`./${file}`, import.meta.url), "utf8");
      expect(source, file).not.toMatch(/localStorage|sessionStorage|document\.cookie|indexedDB|cookies\(\)/);
    }
  });

  it("checks on Enter instead of starting the checkout", () => {
    const source = readFileSync(new URL("./vat-number-field.tsx", import.meta.url), "utf8");
    expect(source).toMatch(/e\.key === "Enter"[\s\S]{0,80}preventDefault/);
  });
});

describe("the VAT notes", () => {
  const notes = (over: Partial<Parameters<typeof VatNotes>[0]> = {}, lang = "en") =>
    words(renderToString(createElement(VatNotes, { text: text(lang), reverseCharge: false, sellerNumber: null, buyerNumber: null, iossNumber: null, importNotice: false, ...over })));

  it("draw nothing for an ordinary order", () => {
    expect(renderToString(createElement(VatNotes, { text: text("en"), reverseCharge: false, sellerNumber: "SE556677889901", buyerNumber: "DE123456789", iossNumber: null, importNotice: false }))).toBe("");
  });

  it("state reverse charge with both numbers, only the numbers they have", () => {
    expect(notes({ reverseCharge: true, sellerNumber: "SE556677889901", buyerNumber: "DE123456789" })).toBe(
      "Reverse charge: VAT has not been charged. The buyer accounts for the VAT in their own country. Seller's VAT number: SE556677889901 Buyer's VAT number: DE123456789",
    );
    expect(notes({ reverseCharge: true, sellerNumber: null, buyerNumber: "DE123456789" })).not.toContain("Seller's");
  });

  it("state IOSS with the number, and the import notice", () => {
    expect(notes({ iossNumber: "IM2760000742" })).toBe("VAT has been collected at checkout under IOSS (IM2760000742). No further VAT is due on delivery.");
    expect(notes({ importNotice: true })).toBe("Import VAT and customs charges may be collected on delivery.");
  });
});
