import { describe, expect, it } from "vitest";

import { openWooState, readIndex, readSiteInput, readWooKey, restUrl, sealWooState, siteFromIndex, siteOfKey, wooAuthorizeUrl } from "./woocommerce";

const SECRET = Buffer.alloc(32, 7);
const KEY = `ck_${"a".repeat(40)}`;
const KEY_SECRET = `cs_${"b".repeat(40)}`;

describe("a WooCommerce site's address as the owner types it (D446 step 1)", () => {
  it("reads the host, and a folder WordPress lives in, from any way of writing it", () => {
    expect(readSiteInput("myshop.com")).toEqual({ host: "myshop.com", path: "" });
    expect(readSiteInput("https://www.MyShop.com/")).toEqual({ host: "www.myshop.com", path: "" });
    expect(readSiteInput("http://myshop.com")).toEqual({ host: "myshop.com", path: "" });
    expect(readSiteInput("example.com/butikk/")).toEqual({ host: "example.com", path: "/butikk" });
    // A page of the shop is not a folder WordPress lives in.
    expect(readSiteInput("https://myshop.com/product/wool-hat/")).toEqual({ host: "myshop.com", path: "" });
    expect(readSiteInput("myshop.com/shop")).toEqual({ host: "myshop.com", path: "" });
    expect(readSiteInput("myshop.com/wp-admin")).toEqual({ host: "myshop.com", path: "" });
  });

  it("refuses what is not a public address", () => {
    for (const raw of ["", "myshop", "my shop.com", "ftp://myshop.com", "https://user:pw@myshop.com", "myshop.com:8080", "10.0.0.1", "-bad-.com"]) expect(readSiteInput(raw)).toBeNull();
  });

  it("builds REST addresses with pretty addresses and without", () => {
    const site = { host: "myshop.com", path: "/butikk" };
    expect(restUrl(site, "wp-json", "wc/v3/products", { page: 2, per_page: 50 })).toBe("https://myshop.com/butikk/wp-json/wc/v3/products?page=2&per_page=50");
    expect(restUrl(site, "rest_route", "wc/v3/products", { page: 2 })).toBe("https://myshop.com/butikk/?rest_route=/wc/v3/products&page=2");
    expect(restUrl(site, "wp-json", "")).toBe("https://myshop.com/butikk/wp-json/");
  });

  it("reads the REST root: WooCommerce is there when it names wc/v3, and WordPress's own address settles the folder", () => {
    const index = readIndex(JSON.stringify({ name: "Kari's\u0007 Shop", url: "https://www.myshop.com/butikk", namespaces: ["wp/v2", "wc/v3"] }));
    expect(index).toEqual({ woo: true, name: "Kari's Shop", site: { host: "www.myshop.com", path: "/butikk" } });
    expect(siteFromIndex({ host: "myshop.com", path: "" }, index!)).toEqual({ host: "www.myshop.com", path: "/butikk" });
    // Another host named by the root is not taken: it would be another site.
    expect(siteFromIndex({ host: "myshop.com", path: "" }, { ...index!, site: { host: "elsewhere.com", path: "" } })).toEqual({ host: "myshop.com", path: "" });
    expect(readIndex(JSON.stringify({ namespaces: ["wp/v2"] }))?.woo).toBe(false);
    expect(readIndex("<html>")).toBeNull();
    expect(readIndex(JSON.stringify({ name: "no namespaces" }))).toBeNull();
  });
});

describe("WooCommerce's authorize page and the note it carries (D446 step 1)", () => {
  const value = { nonce: "n".repeat(32), store: "kari", account: "00000000-0000-4000-8000-000000000001", site: "myshop.com/butikk", root: "wp-json" as const };

  it("asks for a read-only key, posted to our callback over HTTPS", () => {
    const url = new URL(wooAuthorizeUrl({ host: "myshop.com", path: "" }, "wp-json", { appName: "Kaizena Flow", userId: "note", returnUrl: "https://kaizenaflow.com/admin/kari/settings/moving?woocommerce=back", callbackUrl: "https://kaizenaflow.com/api/woocommerce/callback" }));
    expect(url.origin + url.pathname).toBe("https://myshop.com/wc-auth/v1/authorize");
    expect(Object.fromEntries(url.searchParams)).toMatchObject({ app_name: "Kaizena Flow", scope: "read", user_id: "note", callback_url: "https://kaizenaflow.com/api/woocommerce/callback" });
    const plain = new URL(wooAuthorizeUrl({ host: "myshop.com", path: "" }, "rest_route", { appName: "Kaizena Flow", userId: "note", returnUrl: "https://x.example/", callbackUrl: "https://x.example/cb" }));
    expect(plain.searchParams.get("wc-auth-route")).toBe("authorize");
  });

  it("opens a note only as this server signed it, unaltered and in time", () => {
    const now = Date.UTC(2026, 10, 4, 12);
    const sealed = sealWooState(SECRET, value, now);
    expect(openWooState(SECRET, sealed, now + 1000)).toMatchObject(value);
    expect(openWooState(SECRET, sealed, now + 61 * 60_000)).toBeNull();
    expect(openWooState(Buffer.alloc(32, 8), sealed, now)).toBeNull();
    const [body, sig] = sealed.split(".");
    const altered = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(body, "base64url").toString()), store: "someone-else" })).toString("base64url");
    expect(openWooState(SECRET, `${altered}.${sig}`, now)).toBeNull();
    expect(openWooState(SECRET, 42, now)).toBeNull();
  });

  it("takes only a read-only key, in WooCommerce's own shape", () => {
    expect(readWooKey({ consumer_key: KEY, consumer_secret: KEY_SECRET, key_permissions: "read", user_id: "note" })).toEqual({ key: KEY, secret: KEY_SECRET, userId: "note" });
    expect(readWooKey({ consumer_key: KEY, consumer_secret: KEY_SECRET, key_permissions: "read_write", user_id: "note" })).toBeNull();
    expect(readWooKey({ consumer_key: "ck_short", consumer_secret: KEY_SECRET, key_permissions: "read", user_id: "note" })).toBeNull();
    expect(readWooKey({ consumer_key: KEY, consumer_secret: KEY_SECRET, key_permissions: "read" })).toBeNull();
    expect(readWooKey(null)).toBeNull();
  });

  it("reads a kept site back", () => {
    expect(siteOfKey("myshop.com/butikk")).toEqual({ host: "myshop.com", path: "/butikk" });
    expect(siteOfKey("myshop.com")).toEqual({ host: "myshop.com", path: "" });
    expect(siteOfKey("https://myshop.com")).toBeNull();
  });
});
