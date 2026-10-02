import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { beaconBody, campaignParams, DEBOUNCE_MS, MAX_BODY_BYTES, optedOut, referrerHost, shouldSend } from "./visit-beacon";

const bytes = (text: string) => new TextEncoder().encode(text).length;

describe("optedOut", () => {
  it("is true for Global Privacy Control and for Do Not Track under any name", () => {
    expect(optedOut({ globalPrivacyControl: true })).toBe(true);
    expect(optedOut({ doNotTrack: "1" })).toBe(true);
    expect(optedOut({ windowDoNotTrack: "1" })).toBe(true);
    expect(optedOut({ msDoNotTrack: "1" })).toBe(true);
    expect(optedOut({ doNotTrack: "yes" })).toBe(true);
  });

  it("is false when nothing is said, or when tracking is allowed", () => {
    expect(optedOut({})).toBe(false);
    expect(optedOut({ globalPrivacyControl: false, doNotTrack: "0", windowDoNotTrack: null, msDoNotTrack: undefined })).toBe(false);
    expect(optedOut({ doNotTrack: "unspecified" })).toBe(false);
  });
});

describe("referrerHost", () => {
  it("is the host of another site, and empty for none, for the site itself and for junk", () => {
    expect(referrerHost("https://www.google.com/search?q=secret", "shop.example")).toBe("www.google.com");
    expect(referrerHost("https://l.facebook.com/l.php?u=x", "shop.example")).toBe("l.facebook.com");
    expect(referrerHost("https://shop.example/no/cart", "shop.example")).toBe("");
    expect(referrerHost("", "shop.example")).toBe("");
    expect(referrerHost(null, "shop.example")).toBe("");
    expect(referrerHost("not an address", "shop.example")).toBe("");
    expect(referrerHost("javascript:alert(1)", "shop.example")).toBe("");
  });

  it("never carries the referrer's path or query, only its host", () => {
    expect(referrerHost("https://news.example/story/42?token=abc#frag", "shop.example")).toBe("news.example");
  });

  it("keeps an Android app's package name, which the channel rules know", () => {
    expect(referrerHost("android-app://com.google.android.gm", "shop.example")).toBe("com.google.android.gm");
  });

  it("compares the port too, so another port on the same name is another site", () => {
    expect(referrerHost("http://localhost:4000/x", "localhost:3000")).toBe("localhost:4000");
    expect(referrerHost("http://localhost:3000/x", "localhost:3000")).toBe("");
  });
});

describe("campaignParams", () => {
  it("reads the three tags and only the presence of ad click ids", () => {
    const params = campaignParams("?utm_source=Newsletter&utm_medium=email&utm_campaign=spring&gclid=SECRET123&fbclid=&ttclid=x&other=1");
    expect(params).toEqual({ utm_source: "Newsletter", utm_medium: "email", utm_campaign: "spring", gclid: true, fbclid: true, ttclid: true });
    expect(JSON.stringify(params)).not.toContain("SECRET123");
  });

  it("is empty for an address with none, and clips what is too long", () => {
    expect(campaignParams("")).toEqual({});
    expect(campaignParams("?a=b")).toEqual({});
    expect(campaignParams(`?utm_campaign=${"x".repeat(500)}`).utm_campaign).toHaveLength(80);
    expect(campaignParams("?utm_source=%20%20")).toEqual({});
  });
});

describe("beaconBody", () => {
  const base = { store: "demo", path: "/s/demo/no/p/mug", search: "?utm_source=news&gclid=abc", referrer: "https://www.google.com/", ownHost: "shop.example" };

  it("sends the path, the other site's host, the tags and click-id flags on the first page view", () => {
    expect(JSON.parse(beaconBody({ ...base, first: true })!)).toEqual({
      store: "demo",
      path: "/s/demo/no/p/mug",
      referrer: "www.google.com",
      utm_source: "news",
      gclid: true,
    });
  });

  it("sends only the path on later page views of the same load", () => {
    expect(JSON.parse(beaconBody({ ...base, first: false })!)).toEqual({ store: "demo", path: "/s/demo/no/p/mug" });
  });

  it("never sends the query of the path, whatever the caller passes", () => {
    const body = JSON.parse(beaconBody({ ...base, path: "/s/demo/no/search?q=my+name+is", first: false })!);
    expect(body.path).toBe("/s/demo/no/search");
  });

  it("sends nothing for a path that is not one, or without a store", () => {
    expect(beaconBody({ ...base, path: "", first: true })).toBeNull();
    expect(beaconBody({ ...base, path: "no/cart", first: true })).toBeNull();
    expect(beaconBody({ ...base, store: "", first: true })).toBeNull();
  });

  it("stays under the endpoint's size cap, dropping tags before the path", () => {
    const body = beaconBody({
      ...base,
      path: `/${"é".repeat(299)}`,
      search: `?utm_source=${"é".repeat(60)}&utm_medium=${"é".repeat(30)}&utm_campaign=${"é".repeat(80)}`,
      referrer: `https://${"a".repeat(100)}.example/`,
      first: true,
    })!;
    expect(bytes(body)).toBeLessThanOrEqual(MAX_BODY_BYTES);
    expect(JSON.parse(body).path.startsWith("/é")).toBe(true);
  });
});

describe("shouldSend", () => {
  it("leaves out a second page view of the same path within the debounce time", () => {
    expect(shouldSend(null, "/a", 1000)).toBe(true);
    expect(shouldSend({ path: "/a", at: 1000 }, "/a", 1000 + DEBOUNCE_MS - 1)).toBe(false);
    expect(shouldSend({ path: "/a", at: 1000 }, "/a", 1000 + DEBOUNCE_MS)).toBe(true);
  });

  it("counts another path at once, and a clock that went backwards as new", () => {
    expect(shouldSend({ path: "/a", at: 1000 }, "/b", 1001)).toBe(true);
    expect(shouldSend({ path: "/a", at: 5000 }, "/a", 1000)).toBe(true);
  });
});

describe("the beacon stores nothing in the browser", () => {
  const sources = ["src/components/visit-beacon.tsx", "src/lib/visit-beacon.ts", "src/components/store-visits.tsx"];
  const strip = (code: string) => code.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

  it.each(sources)("%s uses neither document.cookie, localStorage, sessionStorage nor IndexedDB", (file) => {
    const code = strip(readFileSync(file, "utf8"));
    expect(code).not.toMatch(/document\s*\.\s*cookie/);
    expect(code).not.toMatch(/localStorage|sessionStorage|indexedDB|cookieStore/);
  });

  it("sends with sendBeacon and nothing else leaves the page", () => {
    const code = strip(readFileSync("src/components/visit-beacon.tsx", "utf8"));
    expect(code).toMatch(/sendBeacon/);
    expect(code).not.toMatch(/\bfetch\s*\(|XMLHttpRequest/);
  });
});
