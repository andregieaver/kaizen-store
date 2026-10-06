import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// The action is a server action; what is tested is what the box draws for what the cart holds (wave 3, run 2, D173, `docs/wave-3-orders.md` 2.1, 4.8).
vi.mock("./actions", () => ({ setGiftAction: async () => ({ ok: true, gift: { isGift: false, to: null, from: null, message: null } }) }));

import type { GiftFields } from "@/lib/gift";

import { GiftBox } from "./cart-gift";

const NONE: GiftFields = { isGift: false, to: null, from: null, message: null };
const draw = (initial: GiftFields, lang = "en") => renderToString(createElement(GiftBox, { store: "demo", market: "no", lang, initial }));
const words = (markup: string) =>
  markup
    .replace(/<!-- -->/g, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/\s+/g, " ");

describe("the cart's gift box", () => {
  it("is a tick box and nothing else while the cart is not a gift", () => {
    const markup = draw(NONE);
    expect(markup).toContain('type="checkbox"');
    expect(markup).not.toContain('checked=""');
    expect(markup).not.toContain("<textarea");
    expect(markup).not.toContain('name="giftTo"');
    expect(words(markup)).toContain("This is a gift");
  });

  it("shows To, From and a message with the live counter when the cart is a gift, filled in with what it holds", () => {
    const markup = draw({ isGift: true, to: "Kari", from: "Ola", message: "Gratulerer!" });
    expect(markup).toContain('checked=""');
    expect(markup).toContain('value="Kari"');
    expect(markup).toContain('value="Ola"');
    expect(markup).toContain("Gratulerer!</textarea>");
    // 300 minus the 11 typed, in the singular and plural the language has.
    expect(words(markup)).toContain("289 characters left");
  });

  it("limits each field in the field itself: 60 for a name, 300 for the message", () => {
    const markup = draw({ isGift: true, to: null, from: null, message: null });
    expect(markup.match(/maxLength="60"/g)).toHaveLength(2);
    expect(markup).toContain('maxLength="300"');
    expect(markup).toContain("rows=\"4\"");
  });

  it("labels every field and ties the counter and the note to the message", () => {
    const markup = draw({ isGift: true, to: null, from: null, message: null });
    for (const label of ["To", "From", "Message"]) expect(words(markup)).toContain(label);
    expect(markup.match(/<label /g)!.length).toBeGreaterThanOrEqual(4);
    expect(markup).toMatch(/aria-describedby="[^"]*-counter [^"]*-printed"/);
    expect(markup).toContain('role="status"');
  });

  it("says what is done with the words: printed on the slip, never sent to the recipient", () => {
    const text = words(draw({ isGift: true, to: null, from: null, message: null }));
    expect(text).toContain("The message is printed on the order's packing slip. The store does not send it to the recipient.");
  });

  it("counts a message of emoji by what the shopper sees, not by what the browser measures", () => {
    // 150 emoji are 300 UTF-16 units but 150 code points: 150 left.
    expect(words(draw({ isGift: true, to: null, from: null, message: "😀".repeat(150) }))).toContain("150 characters left");
  });

  it("draws the buyer's text as text: markup typed into a field is escaped", () => {
    const markup = draw({ isGift: true, to: "<b>x</b>", from: null, message: "<script>alert(1)</script>" });
    expect(markup).not.toContain("<script>");
    expect(markup).not.toContain("<b>x</b>");
    expect(markup).toContain("&lt;script&gt;");
    expect(markup).toContain("&lt;b&gt;x&lt;/b&gt;");
  });

  it("is said in Norwegian, Swedish and Danish by hand", () => {
    const say = (lang: string) => words(draw({ isGift: true, to: null, from: null, message: "Hei" }, lang));
    expect(say("nb")).toContain("Dette er en gave");
    expect(say("nb")).toContain("297 tegn igjen");
    expect(say("sv")).toContain("Det här är en present");
    expect(say("sv")).toContain("297 tecken kvar");
    expect(say("da")).toContain("Det her er en gave");
    expect(say("da")).toContain("297 tegn tilbage");
  });

  it("uses the singular for one character left", () => {
    expect(words(draw({ isGift: true, to: null, from: null, message: "x".repeat(299) }))).toContain("1 character left");
  });
});
