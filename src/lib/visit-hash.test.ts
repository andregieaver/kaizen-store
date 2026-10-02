import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";

import { storeDayKey, visitorHash, VISITOR_LENGTH } from "./visit-hash";

const SECRET = "test-secret-not-a-real-key";
const STORE = "11111111-1111-1111-1111-111111111111";

describe("visitorHash", () => {
  it("is 24 lower-case hex characters", () => {
    const hash = visitorHash(STORE, "203.0.113.7", "Mozilla/5.0", "2026-10-02", SECRET);
    expect(hash).toMatch(/^[0-9a-f]{24}$/);
    expect(hash).toHaveLength(VISITOR_LENGTH);
  });

  it("is the documented construction: HMAC of the parts, keyed by the HMAC of the day", () => {
    const key = createHmac("sha256", SECRET).update("2026-10-02").digest();
    const expected = createHmac("sha256", key).update(JSON.stringify([STORE, "203.0.113.7", "Mozilla/5.0"])).digest("hex").slice(0, 24);
    expect(visitorHash(STORE, "203.0.113.7", "Mozilla/5.0", "2026-10-02", SECRET)).toBe(expected);
  });

  it("is the same for the same visitor on the same day", () => {
    const a = visitorHash(STORE, "203.0.113.7", "UA", "2026-10-02", SECRET);
    expect(visitorHash(STORE, "203.0.113.7", "UA", "2026-10-02", SECRET)).toBe(a);
  });

  it("changes with the day, so a visitor cannot be followed from one day to the next", () => {
    expect(visitorHash(STORE, "203.0.113.7", "UA", "2026-10-02", SECRET)).not.toBe(visitorHash(STORE, "203.0.113.7", "UA", "2026-10-03", SECRET));
  });

  it("changes with the store, the address, the user agent and the secret", () => {
    const base = visitorHash(STORE, "203.0.113.7", "UA", "2026-10-02", SECRET);
    expect(visitorHash("22222222-2222-2222-2222-222222222222", "203.0.113.7", "UA", "2026-10-02", SECRET)).not.toBe(base);
    expect(visitorHash(STORE, "203.0.113.8", "UA", "2026-10-02", SECRET)).not.toBe(base);
    expect(visitorHash(STORE, "203.0.113.7", "UB", "2026-10-02", SECRET)).not.toBe(base);
    expect(visitorHash(STORE, "203.0.113.7", "UA", "2026-10-02", `${SECRET}x`)).not.toBe(base);
  });

  it("cannot be confused by a separator inside the address or the user agent", () => {
    expect(visitorHash(STORE, "a|b", "c", "2026-10-02", SECRET)).not.toBe(visitorHash(STORE, "a", "b|c", "2026-10-02", SECRET));
    expect(visitorHash(STORE, "a", "", "2026-10-02", SECRET)).not.toBe(visitorHash(STORE, "", "a", "2026-10-02", SECRET));
  });

  it("treats missing headers as empty ones", () => {
    expect(visitorHash(STORE, null, undefined, "2026-10-02", SECRET)).toBe(visitorHash(STORE, "", "", "2026-10-02", SECRET));
  });

  it("does not contain the address or the user agent", () => {
    const hash = visitorHash(STORE, "203.0.113.7", "Mozilla/5.0", "2026-10-02", SECRET);
    expect(hash).not.toContain("203");
    expect(hash).not.toContain("Mozilla");
  });

  it("refuses an empty secret, store or day rather than make a guessable hash", () => {
    expect(() => visitorHash(STORE, "1.1.1.1", "UA", "2026-10-02", "")).toThrow();
    expect(() => visitorHash("", "1.1.1.1", "UA", "2026-10-02", SECRET)).toThrow();
    expect(() => visitorHash(STORE, "1.1.1.1", "UA", "", SECRET)).toThrow();
  });
});

describe("storeDayKey", () => {
  it("is the store's calendar date, whatever the time and the zone", () => {
    expect(storeDayKey(new Date("2026-10-02T23:59:59.999Z"), "UTC")).toBe("2026-10-02");
    expect(storeDayKey(new Date("2026-10-03T00:00:00.000Z"), "UTC")).toBe("2026-10-03");
    // Oslo is UTC+2 in October: 22:30Z on the 2nd is half past midnight on the 3rd there, and 21:59Z is not yet.
    expect(storeDayKey(new Date("2026-10-02T22:30:00Z"), "Europe/Oslo")).toBe("2026-10-03");
    expect(storeDayKey(new Date("2026-10-02T21:59:00Z"), "Europe/Oslo")).toBe("2026-10-02");
    // Los Angeles is UTC-7: UTC midnight falls at 17:00 on the previous day there.
    expect(storeDayKey(new Date("2026-10-03T00:30:00Z"), "America/Los_Angeles")).toBe("2026-10-02");
    expect(storeDayKey(new Date("2026-10-03T08:00:00Z"), "America/Los_Angeles")).toBe("2026-10-03");
  });

  it("is one key for a whole store day, so a visitor either side of UTC midnight keeps one hash", () => {
    // Store day 3 October in Oslo runs from 22:00Z on the 2nd to 22:00Z on the 3rd: UTC midnight falls inside it.
    const before = storeDayKey(new Date("2026-10-02T22:30:00Z"), "Europe/Oslo");
    const after = storeDayKey(new Date("2026-10-03T08:00:00Z"), "Europe/Oslo");
    expect(before).toBe(after);
    expect(visitorHash(STORE, "203.0.113.7", "UA", before, SECRET)).toBe(visitorHash(STORE, "203.0.113.7", "UA", after, SECRET));
  });

  it("falls back to the UTC date for a zone that does not exist", () => {
    expect(storeDayKey(new Date("2026-10-02T23:30:00Z"), "Mars/Olympus")).toBe("2026-10-02");
  });
});
