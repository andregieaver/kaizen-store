import { describe, expect, it } from "vitest";

import { cleanHoldingRedirect, holdingAnswer, mayBeHeld } from "./holding";

const own = { site: "kaizenaflow.com", storeDomain: "kaizenaflow.shop" };

describe("which hosts can be held domains (D317 8)", () => {
  it("never Kaizena Flow's own site, a store's host, a preview or a local address", () => {
    expect(mayBeHeld("kaizenaflow.com", own)).toBe(false);
    expect(mayBeHeld("www.kaizenaflow.com", own)).toBe(false);
    expect(mayBeHeld("kaffe.kaizenaflow.shop", own)).toBe(false);
    expect(mayBeHeld("kaizen-abc.vercel.app", own)).toBe(false);
    expect(mayBeHeld("localhost:3000", own)).toBe(false);
    expect(mayBeHeld("127.0.0.1", own)).toBe(false);
  });

  it("any other name, with or without www and a port", () => {
    expect(mayBeHeld("nordisk.shop", own)).toBe(true);
    expect(mayBeHeld("www.nordisk.shop:443", own)).toBe(true);
  });
});

describe("the holder's redirect", () => {
  it("is a whole http(s) address on another host", () => {
    expect(cleanHoldingRedirect("https://example.com/page", "nordisk.shop")).toBe("https://example.com/page");
    expect(cleanHoldingRedirect("javascript:alert(1)", "nordisk.shop")).toBeNull();
    expect(cleanHoldingRedirect("https://www.nordisk.shop/", "nordisk.shop")).toBeNull();
    expect(cleanHoldingRedirect("https://user:pw@example.com", "nordisk.shop")).toBeNull();
    expect(cleanHoldingRedirect("example.com", "nordisk.shop")).toBeNull();
  });
});

describe("what a held domain answers", () => {
  it("is its page in the holder's language, the redirect, or nothing", () => {
    expect(holdingAnswer({ apex: "a.shop", holding: "parked", redirect: null, country: "NO" })).toEqual({ kind: "page", apex: "a.shop", lang: "nb" });
    expect(holdingAnswer({ apex: "a.shop", holding: "parked", redirect: null, country: "DE" })).toEqual({ kind: "page", apex: "a.shop", lang: "en" });
    expect(holdingAnswer({ apex: "a.shop", holding: "redirect", redirect: "https://x.com/", country: null })).toEqual({ kind: "redirect", to: "https://x.com/" });
    expect(holdingAnswer({ apex: "a.shop", holding: "off", redirect: null, country: null })).toBeNull();
    expect(holdingAnswer(null)).toBeNull();
  });
});
