import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { giftCodesAvailable, hashGiftCode, newGiftCode } = await import("./gift-card-codes");

const original = process.env.SETTINGS_ENCRYPTION_KEY;
beforeEach(() => {
  process.env.SETTINGS_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
});
afterEach(() => {
  process.env.SETTINGS_ENCRYPTION_KEY = original;
});

describe("gift card codes on the server (D300)", () => {
  it("keep a code only as its hash, the same however it is typed", () => {
    const made = newGiftCode()!;
    expect(made.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(made.hash).not.toContain(made.code);
    const grouped = (made.code.match(/.{4}/g) ?? []).join("-").toLowerCase();
    expect(hashGiftCode(` ${grouped} `)).toBe(made.hash);
    expect(made.last4).toBe(made.code.slice(-4));
  });

  it("make the hash with a key of its own, so another server's key finds nothing", () => {
    const made = newGiftCode()!;
    process.env.SETTINGS_ENCRYPTION_KEY = Buffer.alloc(32, 8).toString("base64");
    expect(hashGiftCode(made.code)).not.toBe(made.hash);
  });

  it("make no codes without the key", () => {
    delete process.env.SETTINGS_ENCRYPTION_KEY;
    expect(giftCodesAvailable()).toBe(false);
    expect(newGiftCode()).toBeNull();
    expect(hashGiftCode("ABCD")).toBeNull();
  });
});
