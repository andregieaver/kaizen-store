import { randomBytes } from "node:crypto";

import { describe, expect, it } from "vitest";

import { decryptSecret, encryptSecret, parseKey, secretHint } from "./secret-box";

const key = randomBytes(32);

describe("secret box", () => {
  it("round-trips a secret", () => {
    const stored = encryptSecret("sk_test_51abcdef4242", key);
    expect(stored).toMatch(/^v1\./);
    expect(stored).not.toContain("sk_test");
    expect(decryptSecret(stored, key)).toBe("sk_test_51abcdef4242");
  });

  it("uses a fresh IV every time", () => {
    expect(encryptSecret("same", key)).not.toBe(encryptSecret("same", key));
  });

  it("refuses the wrong key", () => {
    const stored = encryptSecret("secret", key);
    expect(() => decryptSecret(stored, randomBytes(32))).toThrow();
  });

  it("refuses tampered ciphertext", () => {
    const stored = encryptSecret("secret", key);
    const parts = stored.split(".");
    const flipped = Buffer.from(parts[3], "base64url");
    flipped[0] ^= 1;
    parts[3] = flipped.toString("base64url");
    expect(() => decryptSecret(parts.join("."), key)).toThrow();
  });

  it("accepts only 32-byte keys", () => {
    expect(parseKey(randomBytes(32).toString("base64"))).not.toBeNull();
    expect(parseKey(randomBytes(16).toString("base64"))).toBeNull();
    expect(parseKey(undefined)).toBeNull();
  });

  it("masks secrets for display", () => {
    expect(secretHint("sk_test_51abcdef4242")).toBe("sk_test_…4242");
    expect(secretHint("whsec_abcdef9876")).toBe("whsec_…9876");
    expect(secretHint("rk_live_xyz1234")).toBe("rk_live_…1234");
  });
});
