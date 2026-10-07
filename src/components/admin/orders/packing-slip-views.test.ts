import { createElement as h } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { t } from "@/lib/i18n";
import { formatMoney } from "@/lib/money";
import type { PackingSlip } from "@/server/packing-slips";

import { PackingSlipView } from "./packing-slip-view";
import { OrderSettingsForm } from "./settings-form";

const plain = (html: string) =>
  html
    .replace(/<script[\s\S]*?<\/script>/g, "")
    .replace(/<!-- -->/g, "")
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/[  ]/g, " ");

const slip = (over: Partial<PackingSlip> = {}): PackingSlip => ({
  orderId: "11111111-1111-4111-8111-111111111111",
  number: "1001",
  placedAt: "2026-10-05T10:30:00.000Z",
  locale: "nb-NO",
  lang: "nb",
  shipTo: { name: "Kari Nordmann", line1: "Gata 1", line2: null, postalCode: "0150", city: "Oslo", country: "NO" },
  lines: [
    { quantity: 2, title: "Mug (White)", sku: "MUG-W" },
    { quantity: 1, title: "Plate", sku: "PLT" },
  ],
  gift: null,
  ...over,
});

const draw = (s: PackingSlip, extra: { breakAfter?: boolean } = {}) =>
  renderToString(h(PackingSlipView, { slip: s, storeName: "Kaffe AS", seller: { legalName: "Kaffe AS", postalAddress: "Gata 2\n0150 Oslo", contactEmail: "hei@kaffe.no" }, ...extra }));

/** Words that belong to money, in the four languages the store writes. A slip has none of them. */
const MONEY_WORDS = /\b(total|subtotal|sum|vat|mva|moms|discount|rabatt|rabat|invoice|faktura|betalt|paid|betald|betalt|price|pris|kr|nok|sek|dkk|eur)\b/i;

describe("the packing slip", () => {
  it("prints the order, the address, the lines with quantity and SKU, and thanks", () => {
    const html = draw(slip());
    const text = plain(html);
    expect(text).toContain("Kaffe AS");
    expect(text).toContain("1001");
    expect(text).toContain("Kari Nordmann");
    expect(text).toContain("0150 Oslo");
    expect(text).toContain("Mug (White)");
    expect(text).toContain("MUG-W");
    expect(text).toContain("5. oktober 2026");
  });

  it("holds no price, total, VAT, discount, payment or invoice word in any of the four languages", () => {
    for (const [lang, locale] of [["nb", "nb-NO"], ["sv", "sv-SE"], ["da", "da-DK"], ["en", "en-GB"]] as const) {
      const html = draw(slip({ lang, locale, gift: { isGift: true, to: "Anna", from: "Kari", message: "Happy birthday" } }));
      // Only what the slip itself says: strip the buyer's own words and the product names before looking for money words.
      const own = plain(html).replace(/Happy birthday|Mug \(White\)|Plate|Kaffe AS|Gata \d|Kari Nordmann|Oslo/g, "");
      expect(own, lang).not.toMatch(MONEY_WORDS);
      // No amount of any order line or total, in any currency the store has.
      for (const minor of [24900, 49800, 124900, 9900]) for (const currency of ["NOK", "SEK", "DKK", "EUR"]) expect(plain(html)).not.toContain(formatMoney(minor, currency, locale));
      expect(html).not.toMatch(/\d+[.,]\d{2}\s?(kr|€|NOK|EUR)/);
    }
  });

  it("is in the order's language, whatever the store's", () => {
    expect(plain(draw(slip({ lang: "nb", locale: "nb-NO" })))).toContain("Leveres til");
    expect(plain(draw(slip({ lang: "sv", locale: "sv-SE" })))).toContain("Levereras till");
    expect(plain(draw(slip({ lang: "da", locale: "da-DK" })))).toContain("Leveres til");
    expect(plain(draw(slip({ lang: "en", locale: "en-GB" })))).toContain("Delivered to");
    // A language with no words of its own falls back to English.
    expect(plain(draw(slip({ lang: "zz", locale: "zz-ZZ" })))).toContain("Delivered to");
  });

  it("prints a gift block above the lines with To, From and the message, line breaks kept", () => {
    const html = draw(slip({ lang: "en", locale: "en-GB", gift: { isGift: true, to: "Anna", from: "Kari", message: "Happy birthday!\nSee you soon." } }));
    const text = plain(html);
    expect(text).toContain("A gift for Anna");
    expect(text).toContain("From Kari");
    expect(text).toContain("Happy birthday!\nSee you soon.");
    expect(html).toMatch(/<p class="whitespace-pre-line">Happy birthday!/);
    expect(html.indexOf("A gift for Anna")).toBeLessThan(html.indexOf("Mug (White)"));
  });

  it("says only 'A gift' when the buyer left no name, and prints nothing for an order that is no gift", () => {
    expect(plain(draw(slip({ lang: "en", locale: "en-GB", gift: { isGift: true, to: null, from: null, message: null } })))).toContain("A gift");
    const plainSlip = plain(draw(slip({ lang: "en", locale: "en-GB" })));
    expect(plainSlip).not.toContain("A gift");
    expect(draw(slip())).not.toContain("<section");
  });

  it("never draws the gift message or any text as HTML", () => {
    const html = draw(slip({ lang: "en", locale: "en-GB", gift: { isGift: true, to: "<i>A</i>", from: "<u>B</u>", message: "<script>alert(1)</script><b>x</b> &amp; y" }, lines: [{ quantity: 1, title: "<img src=x onerror=alert(1)>", sku: "<b>S</b>" }] }));
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<b>x</b>");
    expect(html).not.toContain("<i>A</i>");
    expect(html).not.toContain("<img src=x");
    expect(html).toContain("&lt;b&gt;x&lt;/b&gt;");
    expect(html).toContain("&amp;amp; y");
  });

  it("puts each slip of a bulk print on its own page", () => {
    expect(draw(slip(), { breakAfter: true })).toContain("break-after:page");
    expect(draw(slip())).not.toContain("break-after");
  });

  it("says more follows on a parcel's slip when units remain, in each order's own language, and holds no money word then either (D174)", () => {
    const words = { nb: "Mer av denne bestillingen kommer i en annen pakke.", sv: "", da: "", en: "" } as Record<string, string>;
    for (const [lang, locale] of [["nb", "nb-NO"], ["sv", "sv-SE"], ["da", "da-DK"], ["en", "en-GB"]] as const) {
      const parcel = plain(draw(slip({ lang, locale, scope: "parcel", shipmentId: "33333333-3333-4333-8333-333333333333", moreFollows: true, lines: [{ quantity: 1, title: "Mug (White)", sku: "MUG-W" }] })));
      const expected = t(lang).slip.moreFollows;
      expect(expected, lang).toMatch(/\w/);
      if (words[lang]) expect(expected).toBe(words[lang]);
      expect(parcel, lang).toContain(expected);
      expect(parcel.replace(/Mug \(White\)|Kaffe AS|Gata \d|Kari Nordmann|Oslo/g, ""), lang).not.toMatch(MONEY_WORDS);
      expect(plain(draw(slip({ lang, locale, scope: "parcel", moreFollows: false }))), lang).not.toContain(expected);
    }
  });

  it("marks a reprint of an order with nothing left to send as already sent; a slip of what is still to send says nothing of the kind", () => {
    const reprint = plain(draw(slip({ lang: "en", locale: "en-GB", scope: "reprint" })));
    expect(reprint).toContain(t("en").slip.alreadySent);
    expect(plain(draw(slip({ lang: "nb", locale: "nb-NO", scope: "reprint" })))).toContain("Alle varer (allerede sendt)");
    expect(plain(draw(slip({ lang: "en", locale: "en-GB", scope: "to_send" })))).not.toContain(t("en").slip.alreadySent);
  });

  it("keeps the gift block on a parcel's slip", () => {
    const text = plain(draw(slip({ lang: "en", locale: "en-GB", scope: "parcel", moreFollows: true, gift: { isGift: true, to: "Anna", from: "Kari", message: "Happy birthday" } })));
    expect(text).toContain("A gift for Anna");
    expect(text).toContain("Happy birthday");
    expect(text).toContain(t("en").slip.moreFollows);
  });
});

describe("the order settings", () => {
  const settings = { giftMessages: false, autoArchiveDays: null as number | null, draftValidDays: 7, staffMarkPaid: false };
  const draw2 = (over: { settings?: typeof settings; canEdit?: boolean; isOwner?: boolean } = {}) =>
    renderToString(h(OrderSettingsForm, { settings: over.settings ?? settings, canEdit: over.canEdit ?? true, isOwner: over.isOwner ?? true, action: async () => ({ status: "ok" as const, messages: [] as string[] }) }));

  it("has the four settings with their limits, and says what each does", () => {
    const html = draw2();
    const text = plain(html);
    expect(html).toContain('name="giftMessages"');
    expect(html).toContain('name="autoArchive"');
    expect(html).toContain('name="autoArchiveDays"');
    expect(html).toContain('min="14"');
    expect(html).toContain('max="365"');
    expect(html).toContain('name="draftValidDays"');
    expect(html).toContain('min="1"');
    expect(html).toContain('max="30"');
    expect(html).toContain('name="staffMarkPaid"');
    expect(text).toContain("up to 60 characters");
    expect(text).toContain("up to 300 characters");
    expect(text).toContain("Kaizen does not send the message to anyone");
    expect(text).toContain("Off by default.");
    expect(text).toContain("Recording a payment here does not replace a cash register.");
    expect(text).not.toMatch(/\bnull\b|undefined|NaN/);
  });

  it("shows what is saved", () => {
    const html = draw2({ settings: { giftMessages: true, autoArchiveDays: 30, draftValidDays: 14, staffMarkPaid: true } });
    expect(html).toMatch(/name="giftMessages"[^>]*checked=""|checked=""[^>]*name="giftMessages"/);
    expect(html).toMatch(/name="autoArchive"[^>]*checked=""|checked=""[^>]*name="autoArchive"/);
    expect(html).toContain('value="30"');
    expect(html).toContain('value="14"');
  });

  it("leaves the owner's choice to the owner and sends it from no one else", () => {
    const owner = draw2({ isOwner: true });
    expect(owner).toContain('name="staffMarkPaidShown"');
    const staff = draw2({ isOwner: false, settings: { ...settings, staffMarkPaid: true } });
    expect(staff).not.toContain('name="staffMarkPaid"');
    expect(staff).not.toContain('name="staffMarkPaidShown"');
    expect(plain(staff)).toContain("Staff may record a payment taken outside Kaizen.");
    expect(plain(staff)).toContain("Only the owner can change this choice.");
  });

  it("is read-only for someone who may not change settings", () => {
    const html = draw2({ canEdit: false });
    expect(html).toContain("<fieldset disabled=");
    expect(plain(html)).toContain("You can read these settings but not change them.");
  });
});
