import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  DOCUMENT_LANGUAGES,
  creditNoteWording,
  defaultLatePaymentNote,
  documentLabels,
  documentLanguage,
  prepaidCoverageText,
  vatInCurrencyLabel,
  vatNoteText,
  type DocumentLanguage,
  type VatNoteKey,
} from "./work-invoice-text";

const NOTE_KEYS: VatNoteKey[] = ["not_registered", "reverse_charge", "outside_scope", "exempt"];

describe("which language a document is in", () => {
  it("reads it from the locale", () => {
    expect(documentLanguage("nb-NO")).toBe("nb");
    expect(documentLanguage("nb")).toBe("nb");
    expect(documentLanguage("nn-NO")).toBe("nb");
    expect(documentLanguage("no")).toBe("nb");
    expect(documentLanguage("sv-SE")).toBe("sv");
    expect(documentLanguage("da_DK")).toBe("da");
    expect(documentLanguage("en-GB")).toBe("en");
  });

  it("falls back to English", () => {
    expect(documentLanguage("de-DE")).toBe("en");
    expect(documentLanguage("fi")).toBe("en");
    expect(documentLanguage("")).toBe("en");
    expect(documentLanguage(null)).toBe("en");
    expect(documentLanguage(undefined)).toBe("en");
  });
});

describe("the hand-written texts", () => {
  it("has every label in every language, none empty", () => {
    const english = documentLabels("en");
    for (const language of DOCUMENT_LANGUAGES) {
      const labels = documentLabels(language);
      expect(Object.keys(labels).sort()).toEqual(Object.keys(english).sort());
      for (const [key, value] of Object.entries(labels)) expect(value.trim(), `${language}.${key}`).not.toBe("");
    }
  });

  it("names the documents as each country does", () => {
    expect(documentLabels("nb").invoice).toBe("Faktura");
    expect(documentLabels("nb").creditNote).toBe("Kreditnota");
    expect(documentLabels("sv").creditNote).toBe("Kreditfaktura");
    expect(documentLabels("da").creditNote).toBe("Kreditnota");
    expect(documentLabels("en").creditNote).toBe("Credit note");
    expect(documentLabels("nb").vatNumber).toBe("MVA-nr.");
    expect(documentLabels("da").organisationNumber).toBe("CVR-nr.");
  });

  it("falls back to English for a language it has no text for", () => {
    expect(documentLabels("xx" as DocumentLanguage)).toEqual(documentLabels("en"));
    expect(vatNoteText("exempt", "xx" as DocumentLanguage)).toBe("Exempt from VAT.");
  });

  it("has every VAT note in every language, and the Nordic ones are not English", () => {
    for (const key of NOTE_KEYS) {
      const english = vatNoteText(key, "en");
      expect(english).not.toBe("");
      for (const language of ["nb", "sv", "da"] as const) {
        const text = vatNoteText(key, language);
        expect(text.trim(), `${language}.${key}`).not.toBe("");
        expect(text, `${language}.${key}`).not.toBe(english);
      }
    }
  });

  it("cites the VAT Directive on a reverse charge only for a seller in the EU", () => {
    expect(vatNoteText("reverse_charge", "en")).not.toContain("2006/112");
    expect(vatNoteText("reverse_charge", "en", { sellerInEu: true })).toContain("Article 196");
    expect(vatNoteText("reverse_charge", "sv", { sellerInEu: true })).toContain("Artikel 196");
    expect(vatNoteText("exempt", "en", { sellerInEu: true })).toBe("Exempt from VAT.");
  });

  it("states no rate and no fee in the late-payment note: Work never adds interest itself", () => {
    for (const language of DOCUMENT_LANGUAGES) {
      const note = defaultLatePaymentNote(language);
      expect(note.trim()).not.toBe("");
      expect(note).not.toMatch(/\d/);
    }
    expect(defaultLatePaymentNote("nb")).toContain("forsinkelsesrente");
    expect(defaultLatePaymentNote("sv")).toContain("räntelagen");
    expect(defaultLatePaymentNote("da")).toContain("renteloven");
  });

  it("words a credit note for the invoice it corrects", () => {
    const full = creditNoteWording("en", { invoiceNumber: "W-1001", full: true });
    expect(full.title).toBe("Credit note");
    expect(full.statement).toBe("This credit note cancels invoice W-1001 in full.");
    expect(creditNoteWording("en", { invoiceNumber: "W-1001", full: false }).statement).toContain(
      "part of invoice W-1001",
    );
    for (const language of DOCUMENT_LANGUAGES) {
      for (const isFull of [true, false]) {
        const w = creditNoteWording(language, { invoiceNumber: "W-7", full: isFull });
        expect(w.statement).toContain("W-7");
        expect(w.settlement.trim()).not.toBe("");
      }
    }
    expect(creditNoteWording("sv", { invoiceNumber: "W-7", full: true }).title).toBe("Kreditfaktura");
  });

  it("words the prepaid coverage line and the VAT in the home currency", () => {
    expect(prepaidCoverageText("en", { hours: "12 h", orders: ["#1042"] })).toBe("12 h paid in advance (#1042)");
    expect(prepaidCoverageText("nb", { hours: "12 t", orders: [] })).toBe("12 t forhåndsbetalt");
    expect(vatInCurrencyLabel("nb", "NOK")).toBe("MVA i NOK");
    expect(vatInCurrencyLabel("en", "SEK")).toBe("VAT in SEK");
  });
});

describe("kept out of the AI translation catalogue", () => {
  it("is not imported by the interface text, so nothing in it is machine-translated", () => {
    const lib = join(process.cwd(), "src", "lib");
    for (const file of ["i18n.ts", "ui-catalog.ts", "email-text.ts"]) {
      const source = readFileSync(join(lib, file), "utf8");
      expect(source, file).not.toContain("work-invoice-text");
    }
  });

  it("says in its own words that a person must review it", () => {
    const source = readFileSync(join(process.cwd(), "src", "lib", "work-invoice-text.ts"), "utf8");
    expect(source).toContain("LEGAL REVIEW NEEDED");
  });
});
