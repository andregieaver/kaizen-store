import { describe, expect, it } from "vitest";

import { FRESH_SIGN_IN_SECONDS, signedInWithin } from "./fresh-sign-in";

const now = 1_800_000_000;

describe("a fresh sign-in", () => {
  it("is one inside the last ten minutes, by any method", () => {
    expect(FRESH_SIGN_IN_SECONDS).toBe(600);
    expect(signedInWithin([{ method: "password", timestamp: now - 599 }], now)).toBe(true);
    expect(signedInWithin([{ method: "otp", timestamp: now - 600 }], now)).toBe(true);
    expect(signedInWithin([{ method: "otp", timestamp: now - 601 }], now)).toBe(false);
  });

  it("counts the newest entry, so a code after an old password is fresh", () => {
    expect(signedInWithin([{ method: "password", timestamp: now - 86_400 }, { method: "totp", timestamp: now - 30 }], now)).toBe(true);
  });

  it("is never fresh without a usable claim", () => {
    expect(signedInWithin(undefined, now)).toBe(false);
    expect(signedInWithin([], now)).toBe(false);
    expect(signedInWithin([{ method: "password" }], now)).toBe(false);
    expect(signedInWithin([{ method: "password", timestamp: "now" }], now)).toBe(false);
    expect(signedInWithin("password", now)).toBe(false);
    expect(signedInWithin([null, 5], now)).toBe(false);
  });

  it("does not trust a time from the future", () => {
    expect(signedInWithin([{ method: "password", timestamp: now + 3600 }], now)).toBe(false);
  });
});
