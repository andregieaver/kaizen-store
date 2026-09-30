import { describe, expect, it, vi } from "vitest";

import { heldAffiliateCode, holdAffiliateCode, subscribeAffiliateCode } from "./affiliate-memory";

describe("the code held in the page's memory", () => {
  it("is kept per store, handed only to the store it was for, and let go of", () => {
    holdAffiliateCode("demo", "abcdef23");
    expect(heldAffiliateCode("demo")).toBe("abcdef23");
    expect(heldAffiliateCode("other")).toBeNull();
    holdAffiliateCode("other", "zzzzzz22");
    expect(heldAffiliateCode("demo")).toBeNull();
    expect(heldAffiliateCode("other")).toBe("zzzzzz22");
    holdAffiliateCode("other", null);
    expect(heldAffiliateCode("other")).toBeNull();
  });

  it("tells what shows it when it changes, and only then", () => {
    const listener = vi.fn();
    const stop = subscribeAffiliateCode(listener);
    holdAffiliateCode("demo", "abcdef23");
    holdAffiliateCode("demo", "abcdef23");
    expect(listener).toHaveBeenCalledTimes(1);
    holdAffiliateCode("demo", null);
    expect(listener).toHaveBeenCalledTimes(2);
    stop();
    holdAffiliateCode("demo", "abcdef23");
    expect(listener).toHaveBeenCalledTimes(2);
    holdAffiliateCode("demo", null);
  });

  it("stores nothing in the browser: no cookie, no storage", () => {
    const cookie = vi.fn();
    const local = vi.fn();
    vi.stubGlobal("document", { get cookie() { return ""; }, set cookie(value: string) { cookie(value); } });
    vi.stubGlobal("localStorage", { setItem: local });
    holdAffiliateCode("demo", "abcdef23");
    holdAffiliateCode("demo", null);
    expect(cookie).not.toHaveBeenCalled();
    expect(local).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});
