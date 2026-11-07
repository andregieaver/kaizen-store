import { describe, expect, it } from "vitest";

import { publicEnv, sendcloudPartnerId, serverEnv } from "./env";

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

describe("serverEnv", () => {
  it("accepts a Postgres connection string", () => {
    expect(
      serverEnv({ DATABASE_URL: "postgresql://user:pw@host:6543/postgres" })
        .DATABASE_URL,
    ).toContain("host:6543");
  });

  it("names a missing DATABASE_URL", () => {
    expect(() => serverEnv({})).toThrow(/DATABASE_URL/);
  });
});

describe("sendcloudPartnerId (D483)", () => {
  it("is null until Sendcloud has given Kaizena Flow its partner id, then that UUID", () => {
    expect(sendcloudPartnerId({})).toBeNull();
    expect(sendcloudPartnerId({ SENDCLOUD_PARTNER_ID: " " })).toBeNull();
    expect(sendcloudPartnerId({ SENDCLOUD_PARTNER_ID: " 0F0F0F0F-0000-4000-8000-000000000000 " })).toBe("0F0F0F0F-0000-4000-8000-000000000000");
    expect(() => sendcloudPartnerId({ SENDCLOUD_PARTNER_ID: "flow" })).toThrow(/partner UUID/);
  });
});
