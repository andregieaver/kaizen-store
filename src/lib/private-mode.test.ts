import { describe, expect, it } from "vitest";

import { privateDecision, privatePasswordProblem, privatePath, safeBack } from "./private-mode";

/** Private mode (D339): what the landing page stands in for, where it is, where a visitor goes back to, and the password's rules. */
const gate = (parts: string[], hostBased = false) => privateDecision({ store: "nordic", hostBased, parts, mainMarket: "no" });

describe("a private store's requests", () => {
  it("are shown the landing page in their own market, or the main one for the country chooser", () => {
    expect(gate(["no", "p", "cup"])).toEqual({ landing: "/s/nordic/private/no", market: "no" });
    expect(gate(["se-en", "products"])).toEqual({ landing: "/s/nordic/private/se-en", market: "se-en" });
    expect(gate(["no~abc12"])).toEqual({ landing: "/s/nordic/private/no", market: "no" });
    expect(gate([])).toEqual({ landing: "/s/nordic/private/no", market: "no" });
    expect(gate(["no", "cart"], true)).toEqual({ landing: "/private/no", market: "no" });
  });

  it("keep open the landing page and what was already sold", () => {
    expect(gate(["private", "no"])).toEqual({ open: true });
    for (const open of ["order", "account", "download", "withdraw", "returns", "unsubscribe", "subscription", "deliveries"]) {
      expect(gate(["no", open, "x"]), open).toEqual({ open: true });
    }
    expect(gate(["no", "checkout"])).not.toEqual({ open: true });
    expect(gate(["no", "search"])).not.toEqual({ open: true });
  });

  it("has its landing page under the store's address, or at the root of its own host", () => {
    expect(privatePath("nordic", false, "no")).toBe("/s/nordic/private/no");
    expect(privatePath("nordic", true, "dk-en")).toBe("/private/dk-en");
  });
});

describe("going back once let in", () => {
  it("is to a path of this site only", () => {
    expect(safeBack("/no/p/cup?x=1", "/")).toBe("/no/p/cup?x=1");
    for (const bad of ["https://evil.example/", "//evil.example", "/\\evil", "javascript:alert(1)", "", null, "/a\nb"]) {
      expect(safeBack(bad, "/home"), String(bad)).toBe("/home");
    }
  });
});

describe("a store's password", () => {
  it("is 4 to 100 characters, not only spaces", () => {
    expect(privatePasswordProblem("abc")).toBe("short");
    expect(privatePasswordProblem("    ")).toBe("short");
    expect(privatePasswordProblem("open")).toBeNull();
    expect(privatePasswordProblem("x".repeat(101))).toBe("long");
  });
});
