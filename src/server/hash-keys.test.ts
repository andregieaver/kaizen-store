import { randomBytes } from "node:crypto";

import { afterEach, describe, expect, it, vi } from "vitest";

import { derivedHashKeys } from "../../scripts/lib/hash-keys.mjs";

vi.mock("server-only", () => ({}));

const { hashGiftCode } = await import("./gift-card-codes");
const { recoveryHash } = await import("./recovery-codes");

/**
 * The hash keys of their own (PSI SEC-06): set to what `scripts/hash-keys.mjs` prints, gift card and recovery codes hash as they did under
 * the settings key, and a new settings key then changes none of them.
 */
const keep = { ...process.env };
afterEach(() => {
  process.env = { ...keep };
});

describe("hash keys of their own", () => {
  it("hash every code as before once set to the printed values, and keep doing so after the settings key changes", () => {
    process.env.SETTINGS_ENCRYPTION_KEY = randomBytes(32).toString("base64");
    delete process.env.GIFT_CARD_HASH_KEY;
    delete process.env.RECOVERY_CODE_HASH_KEY;
    const gift = hashGiftCode("ABCD-EFGH-JKLM-NPQR");
    const recovery = recoveryHash("K7QM29WXDB");
    expect(gift).toMatch(/^[0-9a-f]{64}$/);

    Object.assign(process.env, derivedHashKeys(process.env.SETTINGS_ENCRYPTION_KEY));
    expect(hashGiftCode("ABCD-EFGH-JKLM-NPQR")).toBe(gift);
    expect(recoveryHash("K7QM29WXDB")).toBe(recovery);

    process.env.SETTINGS_ENCRYPTION_KEY = randomBytes(32).toString("base64");
    expect(hashGiftCode("ABCD-EFGH-JKLM-NPQR")).toBe(gift);
    expect(recoveryHash("K7QM29WXDB")).toBe(recovery);
  });

  it("print nothing for a settings key that is not 32 bytes", () => {
    expect(derivedHashKeys(undefined)).toBeNull();
    expect(derivedHashKeys(randomBytes(16).toString("base64"))).toBeNull();
  });
});
