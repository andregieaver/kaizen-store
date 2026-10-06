import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { DOCUMENT_LANGUAGES, documentEmailText, documentText, treatmentStatements } from "./invoice-text";

const source = readFileSync(path.join(process.cwd(), "src/lib/invoice-text.ts"), "utf8");

describe("the wording of invoices and credit notes", () => {
  it("is hand-written in nb, sv, da and en, with the same keys in every one, and English for any other language", () => {
    const shape = (v: unknown): unknown => (typeof v === "function" ? "fn" : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, shape(x)])) : typeof v);
    const en = shape(documentText("en"));
    for (const lang of DOCUMENT_LANGUAGES) expect(shape(documentText(lang)), lang).toEqual(en);
    expect(documentText("de")).toEqual(documentText("en"));
    expect(documentText("fi").invoice).toBe("Invoice");
    const mail = (l: string) => Object.keys(documentEmailText(l));
    for (const lang of DOCUMENT_LANGUAGES) expect(mail(lang)).toEqual(mail("en"));
    expect(documentEmailText("fr")).toEqual(documentEmailText("en"));
  });

  it("says a payment taken outside the online checkout in its own words, with the three ways it can be received, in every language (D173)", () => {
    expect(["nb", "sv", "da", "en"].map((l) => documentText(l).paidOutside)).toEqual([
      "Betalt utenfor nettbutikken",
      "Betalt utanför webbutiken",
      "Betalt uden for webshoppen",
      "Paid outside the online checkout",
    ]);
    for (const lang of DOCUMENT_LANGUAGES) {
      const t = documentText(lang);
      expect(Object.keys(t.paymentMethods).sort(), lang).toEqual(["bank_transfer", "cash", "other"]);
      // It is never the words of "paid online", and every method has its own.
      expect(t.paidOutside, lang).not.toBe(t.paidOnline);
      expect(new Set(Object.values(t.paymentMethods)).size, lang).toBe(3);
    }
    expect(documentText("nb").paymentMethods.bank_transfer).toBe("bankoverføring");
    expect(documentText("de").paymentMethods.cash).toBe("cash");
  });

  it("names the documents as each country does", () => {
    expect(["nb", "sv", "da", "en"].map((l) => documentText(l).invoice)).toEqual(["Faktura", "Faktura", "Faktura", "Invoice"]);
    expect(["nb", "sv", "da", "en"].map((l) => documentText(l).creditNote)).toEqual(["Kreditnota", "Kreditfaktura", "Kreditnota", "Credit note"]);
  });

  it("states reverse charge with both numbers' labels and the statutory words of each language", () => {
    expect(documentText("nb").reverseCharge).toContain("Omvendt avgiftsplikt");
    expect(documentText("sv").reverseCharge).toContain("Omvänd skattskyldighet");
    expect(documentText("da").reverseCharge).toContain("Omvendt betalingspligt");
    expect(documentText("en").reverseCharge).toContain("Reverse charge");
    const t = treatmentStatements("nb", { statements: ["reverse_charge", "ioss", "not_registered", "exempt"], sellerVatNumber: "NO1MVA", buyerVatNumber: "DE1", iossNumber: "IM123" });
    expect(t.map((s) => s.key)).toEqual(["reverse_charge", "ioss", "not_registered", "exempt"]);
    expect(t[1].text).toContain("IM123");
    // The IOSS statement needs its number: without one it is not made up.
    expect(treatmentStatements("en", { statements: ["ioss"], sellerVatNumber: null, buyerVatNumber: null, iossNumber: null })).toEqual([]);
  });

  it("builds a sentence from facts only", () => {
    const t = documentText("en");
    expect(t.vatHome({ currency: "NOK", amount: "1234.50", fromCurrency: "EUR", rate: "11.7", asOf: "2026-10-01" })).toBe("VAT in NOK: 1234.50 (rate 11.7 NOK per EUR, 2026-10-01)");
    expect(t.refersTo("F-1", "2026-10-04")).toBe("This credit note refers to invoice F-1 of 2026-10-04.");
    expect(documentText("sv").refersTo("F-1", "2026-10-04")).toContain("F-1");
    expect(documentEmailText("da").invoiceSubject("F-7", "Butik")).toBe("Din faktura F-7 fra Butik");
    expect(documentText("nb").creditRows.return_shipping).toContain("Returfrakt");
  });

  it("is flagged for review, kept out of the AI catalogue and of i18n, and takes no free text into a statutory sentence", () => {
    expect(source).toContain("LEGAL TEXT");
    expect(source).toContain("legal: needs review");
    for (const file of ["src/lib/i18n.ts", "src/lib/ui-catalog.ts"]) expect(readFileSync(path.join(process.cwd(), file), "utf8")).not.toContain("invoice-text");
    // The one function that takes arguments for a statutory sentence takes an IOSS number; the others take numbers and dates.
    const withText = Object.entries(documentText("en")).filter(([, v]) => typeof v === "function").map(([k]) => k).sort();
    expect(withText).toEqual(["creditNoteLink", "invoiceLink", "ioss", "reasonReturn", "refersTo", "vatHome"]);
  });
});
