import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { t } from "@/lib/i18n";

import { GiftNote } from "./gift-note";
import { StaffDiscountRow } from "./staff-discount-row";

const words = (markup: string) =>
  markup
    .replace(/<!-- -->/g, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/\s+/g, " ")
    .trim();

describe("the buyer's gift message shown back to them (wave 3, run 2, D173)", () => {
  const gift = { isGift: true, to: "Kari", from: "Ola", message: "Line one\nLine two" };

  it.each([
    ["nb", "Din gavehilsen", "Til", "Fra"],
    ["sv", "Ditt presentmeddelande", "Till", "Från"],
    ["da", "Din gavehilsen", "Til", "Fra"],
    ["en", "Your gift message", "To", "From"],
  ])("is in %s", (lang, heading, to, from) => {
    const text = words(renderToString(createElement(GiftNote, { gift, m: t(lang) })));
    expect(text).toContain(heading);
    expect(text).toContain(`${to}: Kari`);
    expect(text).toContain(`${from}: Ola`);
    expect(text).toContain("Line one");
  });

  it("keeps the buyer's lines by style and escapes everything else", () => {
    const markup = renderToString(createElement(GiftNote, { gift: { isGift: true, to: null, from: null, message: "a\n<img src=x onerror=alert(1)>" }, m: t("en") }));
    expect(markup).toContain("whitespace-pre-line");
    expect(markup).not.toContain("<img");
    expect(markup).toContain("&lt;img src=x onerror=alert(1)&gt;");
  });

  it("draws nothing for no gift, and only the tick's words for a gift with no text", () => {
    expect(renderToString(createElement(GiftNote, { gift: null, m: t("en") }))).toBe("");
    expect(renderToString(createElement(GiftNote, { gift: { isGift: false, to: null, from: null, message: null }, m: t("en") }))).toBe("");
    const empty = words(renderToString(createElement(GiftNote, { gift: { isGift: true, to: null, from: null, message: null }, m: t("en") })));
    expect(empty).toBe("This is a gift");
  });

  it("only leaves out the lines that have nothing", () => {
    const text = words(renderToString(createElement(GiftNote, { gift: { isGift: true, to: null, from: "Ola", message: null }, m: t("en") })));
    expect(text).toContain("From: Ola");
    expect(text).not.toContain("To:");
  });
});

describe("the discount staff gave on a draft order", () => {
  const money = (minor: number) => `${(minor / 100).toFixed(2)} kr`;
  const row = (order: { staffDiscountMinor: number; staffDiscountLabel: string | null }) => renderToString(createElement(StaffDiscountRow, { order, fallback: "Discount", money }));

  it("is a row under the name staff gave it", () => {
    expect(words(row({ staffDiscountMinor: 1250, staffDiscountLabel: "Loyal customer" }))).toBe("Loyal customer −12.50 kr");
  });

  it("is a discount when staff gave it no name", () => {
    expect(words(row({ staffDiscountMinor: 100, staffDiscountLabel: null }))).toBe("Discount −1.00 kr");
  });

  it("is nothing for none", () => {
    expect(row({ staffDiscountMinor: 0, staffDiscountLabel: null })).toBe("");
  });
});
