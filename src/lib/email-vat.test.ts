import { describe, expect, it } from "vitest";

import { orderVatParagraph, orderVatReliefRows, refundVatNote, vatEmailText, type OrderVatFacts } from "./email-text";

const money = (minor: number) => `${(minor / 100).toFixed(2)} EUR`;

const reverse: OrderVatFacts = {
  vatKind: "reverse_charge",
  vatReliefMinor: 1_277,
  vat: { sellerVatNumber: "SE556677889901", buyerVatNumber: "DE123456789", iossNumber: null },
};
const ioss: OrderVatFacts = { vatKind: "ioss", vatReliefMinor: 0, vat: { sellerVatNumber: null, buyerVatNumber: null, iossNumber: "IM2460000000" } };
const ordinary: OrderVatFacts = { vatKind: "standard", vatReliefMinor: 0, vat: null };

describe("what an order's emails say about its VAT (D157)", () => {
  it.each([
    ["nb", "Omvendt avgiftsplikt", "Selgers mva-nr.", "Kjøpers mva-nr."],
    ["sv", "Omvänd skattskyldighet", "Säljarens momsnummer", "Köparens momsnummer"],
    ["da", "Omvendt betalingspligt", "Sælgers momsnr.", "Købers momsnr."],
    ["en", "Reverse charge", "Seller's VAT number", "Buyer's VAT number"],
  ])("%s: the words and both numbers on a reverse-charge order", (lang, words, seller, buyer) => {
    const paragraph = orderVatParagraph(lang, reverse)!;
    expect(paragraph).toContain(words);
    expect(paragraph).toContain(`${seller}: SE556677889901`);
    expect(paragraph).toContain(`${buyer}: DE123456789`);
    expect(orderVatReliefRows(lang, reverse, money)).toEqual([{ label: vatEmailText(lang).reliefRow, value: "−12.77 EUR", muted: true }]);
    expect(refundVatNote(lang, reverse)).toBe(vatEmailText(lang).refundNet);
  });

  it.each(["nb", "sv", "da", "en"])("%s: the IOSS statement carries the IOSS number", (lang) => {
    expect(orderVatParagraph(lang, ioss)).toContain("IM2460000000");
    expect(orderVatParagraph(lang, ioss)).toContain("IOSS");
  });

  it("shows English in every other language: legal wording is never machine-translated", () => {
    expect(vatEmailText("de")).toBe(vatEmailText("en"));
    expect(vatEmailText("xx")).toBe(vatEmailText("en"));
    expect(orderVatParagraph("de", reverse)).toBe(orderVatParagraph("en", reverse));
  });

  it("says nothing for an ordinary order", () => {
    expect(orderVatParagraph("nb", ordinary)).toBeNull();
    expect(orderVatReliefRows("nb", ordinary, money)).toEqual([]);
    expect(refundVatNote("nb", ordinary)).toBeNull();
    expect(orderVatParagraph("en", { ...ioss, vat: { sellerVatNumber: null, buyerVatNumber: null, iossNumber: null } })).toBeNull();
  });

  it("leaves out a number the order has none of rather than writing a blank", () => {
    const paragraph = orderVatParagraph("en", { ...reverse, vat: { sellerVatNumber: null, buyerVatNumber: "DE123456789", iossNumber: null } })!;
    expect(paragraph).not.toContain("Seller's");
    expect(paragraph).toContain("Buyer's VAT number: DE123456789");
  });

  it("is not part of the AI translation catalogue of the emails: it is built from `text.en`, which does not hold the VAT wording", async () => {
    const { catalogOf } = await import("./ui-catalog");
    const { emailText } = await import("./email-text");
    const catalogue = JSON.stringify(catalogOf("email", emailText("en")));
    expect(catalogue).not.toContain("Reverse charge");
    expect(catalogue).not.toContain("IOSS");
    expect(catalogue).not.toContain("VAT not charged");
  });
});
