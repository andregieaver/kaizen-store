import { describe, expect, it } from "vitest";

import { publicEnv } from "./env";

describe("publicEnv", () => {
  it("returns the Supabase settings when both are present", () => {
    const env = publicEnv({
      NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test",
    });
    expect(env.NEXT_PUBLIC_SUPABASE_URL).toBe("https://example.supabase.co");
  });

  it("names every missing or malformed variable", () => {
    expect(() =>
      publicEnv({ NEXT_PUBLIC_SUPABASE_URL: "not a url" }),
    ).toThrow(
      /NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY/,
    );
  });
});
