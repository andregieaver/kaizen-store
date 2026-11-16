import { describe, expect, it } from "vitest";

import { cookieNoteInput, parseScannedItems, reviewFindings, sameSite, type ScannedItem } from "./cookie-scan";

const item = (over: Partial<ScannedItem>): ScannedItem => ({
  kind: "cookie",
  name: "x",
  domain: "kaizenaflow.com",
  thirdParty: false,
  days: null,
  beforeConsent: false,
  page: "/",
  ...over,
});

describe("cookie scan findings (D58)", () => {
  it("knows Kaizena Flow's cookies, takes the owner's word for the rest, and puts faults first", () => {
    const reviewed = reviewFindings(
      [
        item({ name: "cart_00000000-0000-0000-0000-000000000000_no", beforeConsent: true }),
        item({ name: "_ga", beforeConsent: false }),
        item({ name: "_hjSession_1", domain: "hotjar.com", thirdParty: true }),
        item({ name: "_fbp", beforeConsent: true }),
        item({ kind: "localStorage", name: "_ga" }),
        item({ kind: "localStorage", name: "widget", beforeConsent: true }),
      ],
      [
        { kind: "localStorage", name: "widget", domain: "kaizenaflow.com", category: "marketing", provider: "Widget", purpose: "Ads." },
      ],
    );
    expect(reviewed.map((r) => [r.kind, r.name, r.category, r.problem])).toEqual([
      ["cookie", "_fbp", "marketing", "early"],
      ["localStorage", "widget", "marketing", "early"],
      ["cookie", "_hjSession_1", null, "undescribed"],
      // A storage item is never taken for a cookie of the same name.
      ["localStorage", "_ga", null, "undescribed"],
      ["cookie", "cart_00000000-0000-0000-0000-000000000000_no", "necessary", null],
      ["cookie", "_ga", "statistics", null],
    ]);
    expect(reviewed[0].known?.provider).toBe("Meta");
    expect(reviewed[1].note?.provider).toBe("Widget");
  });

  it("reads stored findings, leaving out what is damaged", () => {
    expect(parseScannedItems(null)).toEqual([]);
    expect(parseScannedItems([item({}), { kind: "cookie" }, "x"])).toEqual([item({})]);
  });

  it("counts a site's subdomains as the site itself", () => {
    expect(sameSite("kaizenaflow.com", ".kaizenaflow.com")).toBe(true);
    expect(sameSite("www.kaizenaflow.com", "kaizenaflow.com")).toBe(true);
    expect(sameSite("kaizenaflow.com", "facebook.com")).toBe(false);
    expect(sameSite("kaizenaflow.com", "notkaizenaflow.com")).toBe(false);
  });
});

describe("the recorder's items in a scan (D657)", () => {
  const id = "3f2b8c1e-7a4d-4b9e-9c2a-1d5e6f7a8b9c";
  it("knows a storage item by an entry of its own kind, never a cookie of that name", () => {
    const reviewed = reviewFindings(
      [
        item({ kind: "sessionStorage", name: `kaizen_replay_${id}` }),
        item({ kind: "localStorage", name: `kaizen_replay_ids_${id}` }),
        item({ kind: "cookie", name: `kaizen_replay_${id}` }),
        item({ kind: "localStorage", name: `kaizen_replay_${id}` }),
      ],
      [],
    );
    expect(reviewed.map((r) => [r.kind, r.name.replace(id, "id"), r.category])).toEqual([
      ["cookie", "kaizen_replay_id", null],
      ["localStorage", "kaizen_replay_id", null],
      ["sessionStorage", "kaizen_replay_id", "recordings"],
      ["localStorage", "kaizen_replay_ids_id", "recordings"],
    ]);
  });

  it("never lets an owner's note put an item under recordings", () => {
    const note = { kind: "cookie", name: "x", domain: "example.com", provider: "Me", purpose: "Mine." };
    expect(cookieNoteInput.safeParse({ ...note, category: "statistics" }).success).toBe(true);
    expect(cookieNoteInput.safeParse({ ...note, category: "recordings" }).success).toBe(false);
  });
});
