import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { entryHash } = await import("./do-not-contact");

describe("the do-not-contact list's keyed hash (D906)", () => {
  it("is keyed with the settings key, unlike a plain hash, and the same for the same entry", () => {
    const key = Buffer.alloc(32, 9).toString("base64");
    const keyed = entryHash("domain", "firma.no", key);
    expect(keyed).toMatch(/^[0-9a-f]{64}$/);
    expect(keyed).toBe(entryHash("domain", "firma.no", key));
    expect(keyed).not.toBe(entryHash("domain", "firma.no", undefined));
    expect(keyed).not.toBe(entryHash("domain", "firma.no", Buffer.alloc(32, 8).toString("base64")));
    expect(entryHash("address", "firma.no", key)).not.toBe(keyed);
  });
});
