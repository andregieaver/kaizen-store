import { describe, expect, it } from "vitest";

import { reportHost, reportInput, storeSlugFromUrl } from "./content-reports";

const problems = { url: "url", category: "category", explanation: "explanation", name: "name", email: "email", goodFaith: "goodFaith" };
const parse = (over: Record<string, unknown>) =>
  reportInput(problems).safeParse({
    url: "https://kaizenaflow.com/s/demo/no/p/demo-handlenett",
    category: "counterfeit_ip",
    explanation: "A copy of a protected design.",
    name: "Kari Nordmann",
    email: "kari@example.com",
    goodFaith: true,
    ...over,
  });
const refused = (over: Record<string, unknown>) => {
  const result = parse(over);
  return result.success ? [] : result.error.issues.map((issue) => issue.message);
};

describe("a notice of illegal content (DSA art. 16(2), D411)", () => {
  it("holds the reasons, the exact address, the sender and the good-faith statement", () => {
    expect(parse({}).success).toBe(true);
    expect(refused({ explanation: "  " })).toEqual(["explanation"]);
    expect(refused({ url: "javascript:alert(1)" })).toEqual(["url"]);
    expect(refused({ url: "not an address" })).toEqual(["url"]);
    expect(refused({ goodFaith: false })).toEqual(["goodFaith"]);
    expect(refused({ category: "spam" })).toEqual(["category"]);
    expect(refused({ name: "" })).toEqual(["name"]);
    expect(refused({ email: "kari" })).toEqual(["email"]);
  });

  it("lets a notice of an offence against children come without a name or an address (art. 16(2)(c))", () => {
    expect(parse({ category: "minors", name: "", email: "" }).success).toBe(true);
    expect(refused({ category: "minors", name: "", email: "nope" })).toEqual(["email"]);
  });

  it("finds the store a storefront address names, and the host of any other", () => {
    expect(storeSlugFromUrl("https://kaizenaflow.com/s/demo/no/p/x")).toBe("demo");
    expect(storeSlugFromUrl("https://kaizenaflow.com/s/demo")).toBe("demo");
    expect(storeSlugFromUrl("https://shop.example.com/p/x")).toBeNull();
    expect(storeSlugFromUrl("nonsense")).toBeNull();
    expect(reportHost("https://WWW.Shop.Example.com/p/x")).toBe("shop.example.com");
    expect(reportHost("nonsense")).toBeNull();
  });
});
