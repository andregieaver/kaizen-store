import { afterEach, describe, expect, it, vi } from "vitest";

import { allowedCode, codeCategories, customCodeInput, liveCustomCode, parseCustomCode, type CustomCode } from "./custom-code";

afterEach(() => vi.unstubAllEnvs());

const code: CustomCode = {
  head: { code: "<meta name=a>", category: "necessary" },
  bodyStart: { code: "<script>1</script>", category: "statistics" },
  bodyEnd: { code: "<script>2</script>", category: "marketing" },
};

describe("a store's own code (D61)", () => {
  it("keeps the places with code, each with a cookie category", () => {
    expect(
      customCodeInput.parse({
        head: { code: "  <meta name=a>  ", category: "necessary" },
        bodyStart: { code: " ", category: "marketing" },
      }),
    ).toEqual({ head: { code: "<meta name=a>", category: "necessary" } });
    expect(customCodeInput.safeParse({ head: { code: "x", category: "sometimes" } }).success).toBe(false);
    expect(customCodeInput.safeParse({ head: { code: "x".repeat(20_001), category: "necessary" } }).success).toBe(false);
    expect(parseCustomCode(null)).toEqual({});
    expect(parseCustomCode({ head: "nope" })).toEqual({});
  });

  it("asks about the optional categories it uses, and adds what the choices allow", () => {
    expect(codeCategories(code)).toEqual(["statistics", "marketing"]);
    expect(codeCategories({ head: code.head })).toEqual([]);
    expect(allowedCode(code, null)).toEqual(["head"]);
    expect(allowedCode(code, { preferences: false, statistics: true, marketing: false })).toEqual(["head", "bodyStart"]);
    expect(allowedCode(code, { preferences: true, statistics: true, marketing: true })).toEqual(["head", "bodyStart", "bodyEnd"]);
  });

  it("is only added once stores have their own hosts (P7)", () => {
    expect(liveCustomCode(code)).toEqual({});
    vi.stubEnv("NEXT_PUBLIC_STORE_DOMAIN", "kaizenstores.com");
    expect(liveCustomCode(code)).toBe(code);
  });
});
