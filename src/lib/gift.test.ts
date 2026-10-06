import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { GIFT_MESSAGE_LINES, GIFT_MESSAGE_MAX, GIFT_NAME_MAX, NO_GIFT, cleanGift, cleanShopperText, giftOfRow, hasGiftText, sameGift, shopperTextLength, shopperTextLines } from "./gift";

const ch = (...codes: number[]) => String.fromCharCode(...codes);
const LIMITS = { maxChars: GIFT_MESSAGE_MAX, maxLines: GIFT_MESSAGE_LINES };
const text = (value: unknown, limits = LIMITS) => {
  const result = cleanShopperText(value, limits);
  if (!result.ok) throw new Error(`refused: ${result.problem}`);
  return result.value;
};

describe("cleaning a shopper's text", () => {
  it("composes Unicode and unifies new lines", () => {
    expect(text(`${ch(0x41, 0x30a)}se`)).toBe(`${ch(0xc5)}se`);
    expect(text("a\r\nb\rc\nd")).toBe("a\nb\nc\nd");
  });

  it("removes control characters but the new line, and the disguising ones: bidirectional controls and zero-width characters", () => {
    expect(text(`a${ch(0)}b${ch(7)}c${ch(0x7f)}d${ch(0x85)}e`)).toBe("abcde");
    expect(text(`Hel${ch(0x202e)}lo`)).toBe("Hello");
    for (const code of [0x202a, 0x202b, 0x202c, 0x202d, 0x202e, 0x2066, 0x2067, 0x2068, 0x2069, 0x200b, 0x200c, 0x200d, 0xfeff]) {
      expect(text(`a${ch(code)}b`), code.toString(16)).toBe("ab");
    }
  });

  it("trims each line's trailing spaces and the whole text, and makes three or more new lines two", () => {
    expect(text("  Hi   \n  there  \n\n\n\n\nbye \n")).toBe("Hi\n  there\n\nbye");
  });

  it("gives nothing for an empty text, one of spaces, and anything that is not a string", () => {
    for (const v of ["", "   \n\t  ", `${ch(0x200b)}${ch(0x200b)}`, null, undefined, 5]) expect(text(v), String(v)).toBeNull();
  });

  it("counts code points: 300 emoji are 300 characters, 301 are refused", () => {
    const smile = String.fromCodePoint(0x1f600);
    expect(cleanShopperText(smile.repeat(300), { maxChars: 300, maxLines: 6 }).ok).toBe(true);
    expect(cleanShopperText(smile.repeat(301), { maxChars: 300, maxLines: 6 })).toEqual({ ok: false, problem: "too_long", over: 1 });
    expect(shopperTextLength(smile.repeat(3))).toBe(3);
  });

  it("refuses a text over the limit and says by how much: it is never cut", () => {
    expect(cleanShopperText("x".repeat(GIFT_MESSAGE_MAX), LIMITS).ok).toBe(true);
    expect(cleanShopperText("x".repeat(GIFT_MESSAGE_MAX + 25), LIMITS)).toEqual({ ok: false, problem: "too_long", over: 25 });
    const lines = Array.from({ length: GIFT_MESSAGE_LINES + 2 }, (_, i) => `line ${i}`).join("\n");
    expect(cleanShopperText(lines, LIMITS)).toEqual({ ok: false, problem: "too_many_lines", over: 2 });
    expect(cleanShopperText(Array.from({ length: GIFT_MESSAGE_LINES }, () => "x").join("\n"), LIMITS).ok).toBe(true);
  });

  it("counts after cleaning, so characters that are removed do not count", () => {
    expect(cleanShopperText(`${"x".repeat(GIFT_MESSAGE_MAX)}${ch(0x200b)}${ch(0)}`, LIMITS).ok).toBe(true);
    expect(shopperTextLines("a\n\n\n\nb")).toBe(3);
    expect(shopperTextLines("")).toBe(0);
  });

  it("keeps markup as the characters that were typed: it is escaped where it is drawn, never turned into HTML", () => {
    expect(text("<script>alert(1)</script> <b>x</b> &amp; \"q\"")).toBe("<script>alert(1)</script> <b>x</b> &amp; \"q\"");
    expect(text("=cmd|' /C calc'!A0")).toBe("=cmd|' /C calc'!A0");
  });
});

describe("the gift fields", () => {
  const input = { isGift: true, to: "  Kari ", from: "Ola", message: "Happy birthday!\n\n\nLove" };

  it("cleans the three texts of a gift", () => {
    expect(cleanGift(input, true)).toEqual({ ok: true, gift: { isGift: true, to: "Kari", from: "Ola", message: "Happy birthday!\n\nLove" } });
  });

  it("is a gift with no text at all when nothing is written", () => {
    expect(cleanGift({ isGift: true }, true)).toEqual({ ok: true, gift: { isGift: true, to: null, from: null, message: null } });
  });

  it("clears the three texts when it is not a gift (unticking clears them)", () => {
    expect(cleanGift({ isGift: false, to: "Kari", from: "Ola", message: "x" }, true)).toEqual({ ok: true, gift: NO_GIFT });
    expect(cleanGift({ to: "Kari" }, true)).toEqual({ ok: true, gift: NO_GIFT });
    expect(cleanGift({ isGift: "yes" }, true)).toEqual({ ok: true, gift: NO_GIFT });
  });

  it("ignores everything when the store's switch is off", () => {
    expect(cleanGift(input, false)).toEqual({ ok: true, gift: NO_GIFT });
  });

  it("refuses a name of 61 characters, a message of 301 or seven lines, and says which field; it refuses the whole gift", () => {
    expect(cleanGift({ isGift: true, to: "n".repeat(GIFT_NAME_MAX), message: "x" }, true).ok).toBe(true);
    expect(cleanGift({ isGift: true, to: "n".repeat(GIFT_NAME_MAX + 1) }, true)).toEqual({ ok: false, problems: [{ field: "to", problem: "too_long", over: 1 }] });
    expect(cleanGift({ isGift: true, from: "n".repeat(70), message: "x".repeat(GIFT_MESSAGE_MAX + 1) }, true)).toEqual({
      ok: false,
      problems: [
        { field: "from", problem: "too_long", over: 10 },
        { field: "message", problem: "too_long", over: 1 },
      ],
    });
    const seven = Array.from({ length: 7 }, (_, i) => `l${i}`).join("\n");
    expect(cleanGift({ isGift: true, message: seven }, true)).toEqual({ ok: false, problems: [{ field: "message", problem: "too_many_lines", over: 1 }] });
  });

  it("makes a new line typed into a name a space (a name is one line)", () => {
    expect(cleanGift({ isGift: true, to: "Kari\nNordmann" }, true)).toMatchObject({ ok: true, gift: { to: "Kari Nordmann" } });
  });

  it("compares gifts: a missing gift is no gift, and a change of any field is a change", () => {
    const gift = { isGift: true, to: "Kari", from: null, message: "Hi" };
    expect(sameGift(gift, { ...gift })).toBe(true);
    expect(sameGift(null, NO_GIFT)).toBe(true);
    expect(sameGift(undefined, undefined)).toBe(true);
    expect(sameGift(gift, { ...gift, message: "Hello" })).toBe(false);
    expect(sameGift(gift, NO_GIFT)).toBe(false);
  });

  it("reads a cart or order row, and says whether there is anything to show beyond the tick", () => {
    expect(giftOfRow({ is_gift: true, gift_to: "Kari", gift_from: "", gift_message: null })).toEqual({ isGift: true, to: "Kari", from: null, message: null });
    expect(giftOfRow({ is_gift: false, gift_to: "x" })).toEqual(NO_GIFT);
    expect(hasGiftText({ isGift: true, to: null, from: null, message: null })).toBe(false);
    expect(hasGiftText({ isGift: true, to: "Kari", from: null, message: null })).toBe(true);
  });
});

describe("the module is fit for a pay route's client bundle", () => {
  it("imports neither zod nor a server module", () => {
    const source = readFileSync(path.join(process.cwd(), "src/lib/gift.ts"), "utf8");
    const imports = [...source.matchAll(/^import\s.*?from\s+["']([^"']+)["']/gm)].map((m) => m[1]);
    expect(imports).toEqual(["./order-limits"]);
    expect(imports.some((i) => i === "zod" || i === "server-only" || i.startsWith("@/server"))).toBe(false);
  });
});
