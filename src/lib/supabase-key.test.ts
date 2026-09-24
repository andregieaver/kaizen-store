import { describe, expect, it } from "vitest";

import { supabaseKeyKind } from "./supabase-key";

const jwt = (role: string) =>
  ["eyJhbGciOiJIUzI1NiJ9", Buffer.from(JSON.stringify({ role })).toString("base64url"), "signature"].join(".");

describe("supabaseKeyKind", () => {
  it("tells the secret key from the publishable one, new and legacy", () => {
    expect(supabaseKeyKind("sb_secret_abc")).toBe("secret");
    expect(supabaseKeyKind(" sb_publishable_abc ")).toBe("publishable");
    expect(supabaseKeyKind(jwt("service_role"))).toBe("secret");
    expect(supabaseKeyKind(jwt("anon"))).toBe("publishable");
  });

  it("does not guess at anything else", () => {
    expect(supabaseKeyKind("not-a-key")).toBe("unknown");
    expect(supabaseKeyKind("a.%%%.b")).toBe("unknown");
  });
});
