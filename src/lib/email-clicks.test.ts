import { describe, expect, it } from "vitest";

import { personRef, readPersonRef } from "./email-clicks";

const key = Buffer.alloc(32, 7);
const other = Buffer.alloc(32, 8);
const broadcast = "11111111-1111-4111-8111-111111111111";
const subscriber = "22222222-2222-4222-8222-222222222222";

describe("a click's person reference (email plan M1.3, D754)", () => {
  it("names the subscriber it was signed for", () => {
    expect(readPersonRef(key, broadcast, personRef(key, broadcast, subscriber))).toBe(subscriber);
  });

  it("is refused for another broadcast, another key, another subscriber or an edited signature", () => {
    const ref = personRef(key, broadcast, subscriber);
    expect(readPersonRef(key, "33333333-3333-4333-8333-333333333333", ref)).toBeNull();
    expect(readPersonRef(other, broadcast, ref)).toBeNull();
    expect(readPersonRef(key, broadcast, ref.replace(subscriber, "44444444-4444-4444-8444-444444444444"))).toBeNull();
    expect(readPersonRef(key, broadcast, `${ref.slice(0, -1)}${ref.endsWith("A") ? "B" : "A"}`)).toBeNull();
  });

  it("is refused when it is missing, malformed or too long, and never throws", () => {
    for (const bad of [null, undefined, "", "x", subscriber, `${subscriber}.`, `not-a-uuid.${"a".repeat(22)}`, `${subscriber}.${"a".repeat(200)}`]) {
      expect(readPersonRef(key, broadcast, bad)).toBeNull();
    }
  });
});
