import { describe, expect, it } from "vitest";

import { SEARCH_MAX_LENGTH, escapeLike, normaliseSearch, searchText, searchWords } from "./order-search";

const ch = (...codes: number[]) => String.fromCharCode(...codes);

describe("the search words", () => {
  it("normalises: NFC, whitespace collapsed, trimmed, control characters as spaces", () => {
    expect(normaliseSearch("  anna   hansen ")).toBe("anna hansen");
    expect(normaliseSearch(`a${ch(0)}b\tc\nd`)).toBe("a b c d");
    expect(normaliseSearch(`${ch(0x41, 0x30a)}se`)).toBe(`${ch(0xc5)}se`);
    expect(normaliseSearch(undefined)).toBe("");
    expect(normaliseSearch(42)).toBe("");
  });

  it("cuts the text to 100 characters, counted in code points", () => {
    expect(normaliseSearch("a".repeat(250))).toHaveLength(SEARCH_MAX_LENGTH);
    const heart = String.fromCodePoint(0x1f600);
    expect([...normaliseSearch(heart.repeat(150))]).toHaveLength(SEARCH_MAX_LENGTH);
  });

  it("splits into words and ignores a word under 2 characters unless it is all digits", () => {
    expect(searchWords("a bc 5 de f").words.map((w) => w.raw)).toEqual(["bc", "5", "de"]);
    expect(searchWords("#").words).toEqual([]);
    expect(searchWords("   ").words).toEqual([]);
  });

  it("uses at most five words and says when more were typed", () => {
    const many = searchWords("one two three four five six seven");
    expect(many.words.map((w) => w.raw)).toEqual(["one", "two", "three", "four", "five"]);
    expect(many.truncated).toBe(true);
    expect(searchWords("one two three four five").truncated).toBe(false);
  });

  it("makes a word an order number only when it has a digit: the # is dropped and it is upper-cased", () => {
    expect(searchWords("#1042").words[0].numberLike).toBe("1042");
    expect(searchWords("k-12ab").words[0].numberLike).toBe("K-12AB");
    expect(searchWords("anna").words[0].numberLike).toBeNull();
    expect(searchWords("#abc").words[0].numberLike).toBeNull();
  });

  it("makes a tag key of a word the way a tag's key is made", () => {
    expect(searchWords("VIP").words[0].key).toBe("vip");
    expect(searchWords("ÆØÅ").words[0].key).toBe("æøå");
  });

  it("puts a backslash before %, _ and \\ so they are literals, and never changes the other characters", () => {
    expect(escapeLike("100%")).toBe("100\\%");
    expect(escapeLike("a_b")).toBe("a\\_b");
    expect(escapeLike("c:\\x")).toBe("c:\\\\x");
    expect(escapeLike("plain")).toBe("plain");
    expect(searchWords("50%").words[0].like).toBe("50\\%");
    expect(searchWords("%_\\").words[0].like).toBe("\\%\\_\\\\");
  });

  it("keeps hostile text as text: quotes, semicolons and SQL words are ordinary words with nothing special about them", () => {
    const hostile = searchWords("'; drop table commerce.orders; --");
    expect(hostile.words.map((w) => w.raw)).toEqual(["';", "drop", "table", "commerce.orders;", "--"]);
    for (const w of hostile.words) expect(w.like).toBe(w.raw);
  });

  it("gives the box back the usable words only", () => {
    expect(searchText("  Anna   a  Hansen ")).toBe("Anna Hansen");
  });
});
