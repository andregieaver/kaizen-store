import { describe, expect, it } from "vitest";

import {
  MESSAGE_MAX,
  chooseAddress,
  cleanMessage,
  creditNoteEmail,
  hostedInvoicePath,
  invoiceEmail,
  isInvoiceToken,
  messageBlocks,
  reminderEmail,
  type WorkEmailFrame,
} from "./work-email";
import { moneyText } from "./work-invoice-print";

const frame = (over: Partial<WorkEmailFrame> = {}): WorkEmailFrame => ({
  storeName: "Konsult <b>Butikk</b>",
  sellerName: "Konsult AS",
  url: "https://example.test/s/konsult/no/account/invoice/AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
  footer: ["Konsult AS · Org.nr. 923456789"],
  ...over,
});

const facts = (locale: string) => ({
  documentNumber: "W-1001",
  dueOn: "2026-10-12",
  locale,
  currency: "NOK",
  amountDueMinor: 187_500,
});

describe("the invoice email, in the four document languages", () => {
  const cases = [
    { locale: "nb-NO", lang: "nb", subject: "Faktura W-1001 fra Konsult <b>Butikk</b>", due: "Forfallsdato", open: "Se fakturaen" },
    { locale: "sv-SE", lang: "sv", subject: "Faktura W-1001 från Konsult <b>Butikk</b>", due: "Förfallodatum", open: "Visa fakturan" },
    { locale: "da-DK", lang: "da", subject: "Faktura W-1001 fra Konsult <b>Butikk</b>", due: "Forfaldsdato", open: "Se fakturaen" },
    { locale: "en-GB", lang: "en", subject: "Invoice W-1001 from Konsult <b>Butikk</b>", due: "Due date", open: "View the invoice" },
    // Any other language reads as English, as the document does.
    { locale: "de-DE", lang: "en", subject: "Invoice W-1001 from Konsult <b>Butikk</b>", due: "Due date", open: "View the invoice" },
  ];
  for (const c of cases) {
    it(`writes ${c.locale} in ${c.lang}`, () => {
      const email = invoiceEmail(frame(), facts(c.locale), null);
      expect(email.subject).toBe(c.subject);
      expect(email.html).toContain(`<html lang="${c.lang}">`);
      expect(email.text).toContain(c.due);
      expect(email.text).toContain(`${c.open}: https://example.test/`);
      // The amount is the frozen one in the document's own locale.
      expect(email.text).toContain(moneyText(187_500, "NOK", c.locale));
      // Names are text, never markup.
      expect(email.html).not.toContain("<b>Butikk</b>");
      expect(email.html).toContain("&lt;b&gt;Butikk&lt;/b&gt;");
    });
  }

  it("has no link or button when the store has no market to link to", () => {
    const email = invoiceEmail(frame({ url: null }), facts("nb-NO"), null);
    expect(email.html).not.toContain("<a ");
    expect(email.text).not.toContain("http");
  });

  it("puts the person's note on top as paragraphs, escaped", () => {
    const email = invoiceEmail(frame(), facts("en"), "Thanks <script>x</script>\n\nSecond paragraph");
    expect(email.html).toContain("Thanks &lt;script&gt;x&lt;/script&gt;");
    expect(email.html).not.toContain("<script>");
    expect(email.text.indexOf("Thanks")).toBeLessThan(email.text.indexOf("has sent you an invoice"));
    expect(email.text).toContain("Second paragraph");
  });
});

describe("credit note and reminder emails", () => {
  it("says which invoice a credit note is against, with a positive amount", () => {
    const email = creditNoteEmail(
      frame(),
      { documentNumber: "WCN-1", invoiceNumber: "W-1001", locale: "sv-SE", currency: "SEK", totalMinor: 12_500 },
      null,
    );
    expect(email.subject).toBe("Kreditfaktura WCN-1 från Konsult <b>Butikk</b>");
    expect(email.text).toContain("faktura W-1001");
    expect(email.text).toContain(moneyText(12_500, "SEK", "sv-SE"));
  });

  it("reminds of what is outstanding and the due date, plainly", () => {
    const email = reminderEmail(frame(), { ...facts("da-DK"), amountDueMinor: 50_000 }, null);
    expect(email.subject).toBe("Påmindelse: faktura W-1001 fra Konsult <b>Butikk</b>");
    expect(email.text).toContain("forfaldsdato");
    expect(email.text).toContain(moneyText(50_000, "NOK", "da-DK"));
    expect(email.text).not.toMatch(/inkasso|rente|gebyr|fee|interest/i);
  });
});

describe("the small rules", () => {
  it("chooses the first address there is and refuses one that is not an address", () => {
    expect(chooseAddress(null, "  ", "a@b.no")).toEqual({ ok: true, address: "a@b.no" });
    expect(chooseAddress(" x@y.no ", "a@b.no")).toEqual({ ok: true, address: "x@y.no" });
    expect(chooseAddress(null, "")).toEqual({ ok: false, reason: "no_email" });
    expect(chooseAddress("not an address")).toEqual({ ok: false, reason: "invalid_email" });
    // The person's own choice is not silently replaced by another address.
    expect(chooseAddress("nope", "a@b.no")).toEqual({ ok: false, reason: "invalid_email" });
  });

  it("cleans a message: control characters out, at most the limit, empty is none", () => {
    expect(cleanMessage("  hi\u0000 there\r\nnext ")).toBe("hi there\nnext");
    expect(cleanMessage("   ")).toBeNull();
    expect(cleanMessage(null)).toBeNull();
    expect(cleanMessage("x".repeat(MESSAGE_MAX + 50))?.length).toBe(MESSAGE_MAX);
    expect(messageBlocks("a\n\n\nb\nc")).toEqual([
      { type: "paragraph", text: "a" },
      { type: "paragraph", text: "b\nc" },
    ]);
  });

  it("builds the hosted path and reads a token like the server does", () => {
    expect(hostedInvoicePath("abc")).toBe("/account/invoice/abc");
    expect(hostedInvoicePath("abc", "id-1")).toBe("/account/invoice/abc?credit=id-1");
    expect(isInvoiceToken("A".repeat(32))).toBe(true);
    expect(isInvoiceToken("short")).toBe(false);
    expect(isInvoiceToken(`${"A".repeat(30)}/..`)).toBe(false);
  });
});
