import { describe, expect, it } from "vitest";

import { readUnlock, signUnlock, unlockCookieName, unlocks, unlockSeconds } from "./unlock-pass";

/** A private store's pass (D339): signed, of one kind, for one store, ending, and a password pass only under the store's version. */
const secret = Buffer.alloc(32, 7);
const other = Buffer.alloc(32, 8);
const store = { id: "11111111-1111-4111-8111-111111111111", slug: "nordic" };
const now = Date.UTC(2026, 9, 27, 12);

describe("the unlock pass", () => {
  it("is read back as it was signed, and only by this server's secret", () => {
    const token = signUnlock(secret, { kind: "password", storeId: store.id, store: store.slug, version: 3 }, now);
    expect(readUnlock(secret, token, now)).toMatchObject({ kind: "password", storeId: store.id, store: "nordic", version: 3 });
    expect(readUnlock(other, token, now)).toBeNull();
    expect(readUnlock(secret, `${token}x`, now)).toBeNull();
    expect(readUnlock(secret, "", now)).toBeNull();
    expect(readUnlock(secret, "a.b.c", now)).toBeNull();
  });

  it("ends: a password pass after 30 days, staff's after 12 hours, the hand-over after 90 seconds", () => {
    const sign = (kind: "password" | "staff" | "enter") => signUnlock(secret, { kind, storeId: store.id, store: store.slug, version: 1 }, now);
    expect(readUnlock(secret, sign("password"), now + 29 * 86_400_000)).not.toBeNull();
    expect(readUnlock(secret, sign("password"), now + 30 * 86_400_000 + 1)).toBeNull();
    expect(readUnlock(secret, sign("staff"), now + 12 * 3_600_000 + 1)).toBeNull();
    expect(readUnlock(secret, sign("enter"), now + 91_000)).toBeNull();
    expect(unlockSeconds("password")).toBe(30 * 86_400);
  });

  it("lets in for its own store only, a password pass only under the store's version, and never the hand-over", () => {
    const password = signUnlock(secret, { kind: "password", storeId: store.id, store: store.slug, version: 2 }, now);
    const staff = signUnlock(secret, { kind: "staff", storeId: store.id, store: store.slug, version: 0 }, now);
    const enter = signUnlock(secret, { kind: "enter", storeId: store.id, store: store.slug, version: 0 }, now);
    expect(unlocks(secret, password, { id: store.id, version: 2 }, now)).toBe(true);
    expect(unlocks(secret, password, { id: store.id, version: 3 }, now)).toBe(false);
    expect(unlocks(secret, password, { id: "22222222-2222-4222-8222-222222222222", version: 2 }, now)).toBe(false);
    expect(unlocks(secret, staff, { id: store.id, version: 9 }, now)).toBe(true);
    expect(unlocks(secret, enter, { id: store.id, version: 0 }, now)).toBe(false);
    expect(unlocks(null, staff, { id: store.id, version: 9 }, now)).toBe(false);
  });

  it("is kept in a cookie of its own per store", () => {
    expect(unlockCookieName(store.id)).toBe(`kaizen_unlock_${store.id}`);
  });
});
