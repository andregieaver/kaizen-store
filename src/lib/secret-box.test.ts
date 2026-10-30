import { randomBytes } from "node:crypto";

import { describe, expect, it } from "vitest";

import { decryptSecret, encryptSecret, keptUnder, keyId, parseKey, previousKeys, secretHint } from "./secret-box";

const key = randomBytes(32);

describe("secret box", () => {
  it("round-trips a secret", () => {
    const stored = encryptSecret("sk_test_51abcdef4242", key);
    expect(stored).toMatch(/^v2\.[0-9a-f]{8}\./);
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
    const flipped = Buffer.from(parts[4], "base64url");
    flipped[0] ^= 1;
    parts[4] = flipped.toString("base64url");
    expect(() => decryptSecret(parts.join("."), key)).toThrow();
  });

  it("names the key in v2, reads it with the key it names, and refuses one it does not have (PSI SEC-06)", () => {
    const old = randomBytes(32);
    const stored = encryptSecret("sk_live_51abc9999", key, "v2");
    expect(stored.split(".")).toHaveLength(5);
    expect(stored.startsWith(`v2.${keyId(key)}.`)).toBe(true);
    expect(keyId(key)).toMatch(/^[0-9a-f]{8}$/);
    expect(stored).not.toContain(key.toString("base64url"));
    expect(decryptSecret(stored, key, [])).toBe("sk_live_51abc9999");
    // During a rotation the old key is the previous one: a secret it kept is read by its name, whichever key is current.
    const kept = encryptSecret("whsec_old1234", old, "v2");
    expect(decryptSecret(kept, key, [old])).toBe("whsec_old1234");
    expect(() => decryptSecret(kept, key, [])).toThrow("a key this server does not have");
    expect(keptUnder(stored, key)).toBe(true);
    expect(keptUnder(kept, key)).toBe(false);
  });

  it("reads a v1 secret with the current key, then the previous one", () => {
    const old = randomBytes(32);
    const kept = encryptSecret("rk_live_old", old, "v1");
    expect(decryptSecret(kept, key, [old])).toBe("rk_live_old");
    expect(() => decryptSecret(kept, key, [])).toThrow();
    expect(keptUnder(kept, old)).toBe(false);
  });

  it("refuses a v2 secret whose ciphertext was changed", () => {
    const parts = encryptSecret("secret", key, "v2").split(".");
    const flipped = Buffer.from(parts[4], "base64url");
    flipped[0] ^= 1;
    parts[4] = flipped.toString("base64url");
    expect(() => decryptSecret(parts.join("."), key, [])).toThrow();
  });

  it("takes the previous key from its own setting, ignoring one that is not 32 bytes", () => {
    expect(previousKeys(undefined)).toEqual([]);
    expect(previousKeys(randomBytes(16).toString("base64"))).toEqual([]);
    const old = randomBytes(32);
    expect(previousKeys(old.toString("base64"))).toEqual([old]);
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
