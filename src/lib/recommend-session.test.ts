import { describe, expect, it } from "vitest";

import { attributionFor, newSessionId, readSession, recordClick, recordSearch, recordView, signalsOf, SESSION_KEY } from "./recommend-session";
import { attributionOf, parseAttribution } from "./recommendations";

const memory = () => {
  const data = new Map<string, string>();
  return { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v), data };
};
const P1 = "11111111-1111-4111-8111-111111111111";
const P2 = "22222222-2222-4222-8222-222222222222";

describe("the tab's session", () => {
  it("makes an id the server accepts and keeps it", () => {
    const storage = memory();
    const first = readSession(storage, 1_000, () => newSessionId());
    expect(first.id).toMatch(/^[a-z0-9]{24}$/);
    recordView(storage, P1, 2_000);
    expect(readSession(storage, 3_000).id).toBe(readSession(storage, 3_000).id);
  });

  it("remembers views and searches newest first, once each", () => {
    const storage = memory();
    recordView(storage, P1, 1_000);
    recordView(storage, P2, 2_000);
    recordView(storage, P1, 3_000);
    recordSearch(storage, "  Red   lamp ", 4_000);
    recordSearch(storage, "red lamp", 5_000);
    const session = readSession(storage, 6_000);
    expect(signalsOf(session)).toEqual({ views: [P1, P2], searches: ["red lamp"] });
  });

  it("forgets what is older than six hours", () => {
    const storage = memory();
    recordView(storage, P1, 0);
    expect(readSession(storage, 7 * 3_600_000).views).toEqual([]);
  });

  it("survives damaged storage and storage that refuses", () => {
    const storage = memory();
    storage.data.set(SESSION_KEY, "{not json");
    expect(readSession(storage).views).toEqual([]);
    expect(() => recordView({ getItem: () => { throw new Error("no"); }, setItem: () => { throw new Error("no"); } }, P1)).not.toThrow();
    expect(readSession(null).id).toMatch(/^[a-z0-9]{24}$/);
  });

  it("sends the clicks of the last half hour with an add to cart", () => {
    const storage = memory();
    recordClick(storage, P1, "product", "ai", 1_000);
    recordClick(storage, P2, "listing", "baseline", 1_000 + 20 * 60_000);
    const sent = parseAttribution(attributionFor(storage, 1_000 + 29 * 60_000));
    expect(sent?.clicks.map((c) => c.p)).toEqual([P2, P1]);
    expect(attributionOf(sent!, P1)).toEqual({ session: sent!.session, arm: "ai", placement: "product" });
    expect(attributionOf(sent!, "33333333-3333-4333-8333-333333333333")).toBeNull();
    // After half an hour the first click no longer counts; later still, none does.
    expect(parseAttribution(attributionFor(storage, 1_000 + 31 * 60_000))?.clicks.map((c) => c.p)).toEqual([P2]);
    expect(attributionFor(storage, 1_000 + 60 * 60_000)).toBeNull();
  });
});
