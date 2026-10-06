import { describe, expect, it } from "vitest";

import { CHANNELS, type Channel } from "./analytics-channels";
import {
  channelLabel,
  channelTable,
  classifyChannel,
  cleanCampaign,
  cleanSource,
  funnel,
  knownHost,
  landingKind,
  ltvToCac,
  isNotAChannel,
  normalizeHost,
  STAFF_CHANNEL,
  UNKNOWN_CHANNEL,
  type ChannelInput,
  type ClassifyInput,
} from "./analytics-traffic";

const OWN = ["demo.kaizen.shop", "www.minbutikk.no"];
const classify = (over: Partial<ClassifyInput> = {}) => classifyChannel({ ownHosts: OWN, ...over });

describe("normalizeHost", () => {
  it("lower-cases and strips www, m, port, path, user and the trailing dot", () => {
    expect(normalizeHost("WWW.Google.NO")).toBe("google.no");
    expect(normalizeHost("m.facebook.com")).toBe("facebook.com");
    expect(normalizeHost("www.m.facebook.com")).toBe("facebook.com");
    expect(normalizeHost("facebook.com:8080")).toBe("facebook.com");
    expect(normalizeHost("https://l.facebook.com/l.php?u=x")).toBe("l.facebook.com");
    expect(normalizeHost("https://user:pw@shop.example.com/a")).toBe("shop.example.com");
    expect(normalizeHost("example.com.")).toBe("example.com");
    expect(normalizeHost("  example.com/path?q  ")).toBe("example.com");
  });

  it("keeps a name that would be nothing without its prefix", () => {
    expect(normalizeHost("www.com")).toBe("www.com");
    expect(normalizeHost("m.com")).toBe("m.com");
    expect(normalizeHost("localhost")).toBe("localhost");
  });

  it("writes international names the same way however they come", () => {
    expect(normalizeHost("bücher.no")).toBe("xn--bcher-kva.no");
    expect(normalizeHost("www.BÜCHER.no")).toBe("xn--bcher-kva.no");
    expect(normalizeHost("xn--bcher-kva.no")).toBe("xn--bcher-kva.no");
  });

  it("reads an app's referrer address", () => {
    expect(normalizeHost("android-app://com.google.android.gm/")).toBe("com.google.android.gm");
  });

  it("never throws, and gives nothing for what is not a host", () => {
    for (const garbage of ["", "   ", "http://", "://", "a b", "[::1]", "http://[::1]/", "a..b", "-bad.com", "x".repeat(400), "%%%", "http://exa mple.com", "\u0000"]) {
      expect(() => normalizeHost(garbage), garbage).not.toThrow();
      expect(normalizeHost(garbage), garbage).toBe("");
    }
    for (const notText of [null, undefined, 5, {}, [], true]) expect(normalizeHost(notText)).toBe("");
  });
});

describe("cleanSource and cleanCampaign", () => {
  it("lower-cases, tidies whitespace and takes out markup characters", () => {
    expect(cleanSource("  Newsletter  ")).toBe("newsletter");
    expect(cleanSource("Black   Friday\tMail")).toBe("black friday mail");
    expect(cleanSource('<script>"x"</script>')).toBe("script x /script");
    expect(cleanSource("a\u0000b")).toBe("a b");
  });

  it("names hosts and short forms as the platform", () => {
    expect(cleanSource("l.facebook.com")).toBe("facebook");
    expect(cleanSource("fb")).toBe("facebook");
    expect(cleanSource("IG")).toBe("instagram");
    expect(cleanSource("t.co")).toBe("twitter");
    expect(cleanSource("x")).toBe("twitter");
    expect(cleanSource("www.google.no")).toBe("google");
    expect(cleanSource("e-mail")).toBe("email");
    expect(cleanSource("blog.partner.no")).toBe("blog.partner.no");
  });

  it("cuts to 40 (source) or 80 (campaign) characters and is empty for non-text", () => {
    expect(cleanSource("a".repeat(100))).toHaveLength(40);
    expect(cleanCampaign("b".repeat(100))).toHaveLength(80);
    expect(cleanCampaign("  Spring_Sale 2026 ")).toBe("spring_sale 2026");
    for (const notText of [null, undefined, 3, {}]) {
      expect(cleanSource(notText)).toBe("");
      expect(cleanCampaign(notText)).toBe("");
    }
  });

  it("does not leave a trailing space where it cut", () => {
    expect(cleanSource(`${"a".repeat(39)} b`)).toBe("a".repeat(39));
  });

  it("is always a string: names of Object's own members are plain text, not looked up", () => {
    for (const name of ["constructor", "__proto__", "prototype", "valueOf", "hasOwnProperty", "toString", "__defineGetter__"]) {
      expect(cleanSource(name)).toBe(name.toLowerCase());
      const classified = classifyChannel({ utmSource: name, ownHosts: [] });
      expect(typeof classified.source).toBe("string");
      expect(classified.source).toBe(name.toLowerCase());
      expect(classified.channel).toBe("other");
    }
  });
});

describe("knownHost", () => {
  it.each([
    ["google.no", "google", "search"],
    ["google.com", "google", "search"],
    ["google.co.uk", "google", "search"],
    ["google.com.br", "google", "search"],
    ["images.google.com", "google", "search"],
    ["com.google.android.googlequicksearchbox", "google", "search"],
    ["bing.com", "bing", "search"],
    ["cn.bing.com", "bing", "search"],
    ["duckduckgo.com", "duckduckgo", "search"],
    ["ecosia.org", "ecosia", "search"],
    ["search.yahoo.com", "yahoo", "search"],
    ["no.search.yahoo.com", "yahoo", "search"],
    ["yahoo.com", "yahoo", "search"],
    ["yandex.ru", "yandex", "search"],
    ["yandex.com.tr", "yandex", "search"],
    ["ya.ru", "yandex", "search"],
    ["startpage.com", "startpage", "search"],
    ["search.brave.com", "brave", "search"],
    ["kagi.com", "kagi", "search"],
    ["l.facebook.com", "facebook", "social"],
    ["lm.facebook.com", "facebook", "social"],
    ["fb.me", "facebook", "social"],
    ["l.instagram.com", "instagram", "social"],
    ["t.co", "twitter", "social"],
    ["twitter.com", "twitter", "social"],
    ["x.com", "twitter", "social"],
    ["linkedin.com", "linkedin", "social"],
    ["lnkd.in", "linkedin", "social"],
    ["tiktok.com", "tiktok", "social"],
    ["pinterest.com", "pinterest", "social"],
    ["no.pinterest.com", "pinterest", "social"],
    ["pinterest.co.uk", "pinterest", "social"],
    ["pin.it", "pinterest", "social"],
    ["youtube.com", "youtube", "social"],
    ["youtu.be", "youtube", "social"],
    ["out.reddit.com", "reddit", "social"],
    ["mail.google.com", "gmail", "email"],
    ["outlook.live.com", "outlook", "email"],
    ["mail.yahoo.com", "yahoo mail", "email"],
    ["com.google.android.gm", "gmail", "email"],
  ])("%s is %s (%s)", (host, label, kind) => {
    expect(knownHost(host)).toEqual({ label, kind });
  });

  it.each(["docs.google.com", "sites.google.com", "accounts.google.com", "box.com", "next.com", "notx.com", "mysearch.brave.com.evil.no", "facebook.com.evil.no", "evilgoogle.com", "google.evil.com", "example.com", ""])(
    "%s is not known",
    (host) => {
      expect(knownHost(host)).toBeNull();
    },
  );
});

describe("classifyChannel: utm_medium", () => {
  it.each<[string, string | undefined, Channel]>([
    ["cpc", undefined, "paid_search"],
    ["CPC", "google", "paid_search"],
    ["ppc", "bing", "paid_search"],
    ["paid", undefined, "paid_search"],
    ["paidsearch", undefined, "paid_search"],
    ["paid-search", undefined, "paid_search"],
    ["Paid Search", undefined, "paid_search"],
    ["sem", undefined, "paid_search"],
    ["paid_social", undefined, "paid_social"],
    ["paid-social", "facebook", "paid_social"],
    ["social-paid", undefined, "paid_social"],
    ["cpc", "facebook", "paid_social"],
    ["cpc", "fb", "paid_social"],
    ["paid", "instagram", "paid_social"],
    ["cpm", "tiktok", "paid_social"],
    ["cpm", "somenetwork", "other"],
    ["email", undefined, "email"],
    ["E-Mail", "klaviyo", "email"],
    ["newsletter", undefined, "email"],
    ["affiliate", "partnerx", "affiliate"],
    ["partner", undefined, "affiliate"],
    ["social", "facebook", "organic_social"],
    ["social-media", undefined, "organic_social"],
    ["organic", "google", "organic_search"],
    ["organic", "facebook", "organic_social"],
    ["referral", "blog.example.no", "referral"],
    ["banner", undefined, "other"],
    ["qr", undefined, "other"],
    ["display", "x", "other"],
  ])("medium %s with source %s is %s", (utmMedium, utmSource, channel) => {
    expect(classify({ utmMedium, utmSource }).channel).toBe(channel);
  });

  it("lets a tagged medium win over the referrer and over own host", () => {
    expect(classify({ utmMedium: "email", referrerHost: "google.com" }).channel).toBe("email");
    expect(classify({ utmMedium: "cpc", referrerHost: "demo.kaizen.shop" }).channel).toBe("paid_search");
  });

  it("treats an empty or 'none' medium as no medium", () => {
    expect(classify({ utmMedium: "", referrerHost: "google.com" }).channel).toBe("organic_search");
    expect(classify({ utmMedium: "(none)", referrerHost: "google.com" }).channel).toBe("organic_search");
    expect(classify({ utmMedium: "  ", referrerHost: undefined }).channel).toBe("direct");
  });

  it("calls a tag it cannot read 'other', not whatever the referrer was", () => {
    expect(classify({ utmMedium: "banner", referrerHost: "google.com" }).channel).toBe("other");
  });
});

describe("classifyChannel: click ids", () => {
  it("gclid is paid search even from Google's organic referrer", () => {
    expect(classify({ referrerHost: "www.google.no", clickIds: { gclid: true } })).toEqual({ channel: "paid_search", source: "google", campaign: "" });
    expect(classify({ clickIds: { gclid: true } }).channel).toBe("paid_search");
  });

  it("ttclid is paid social", () => {
    expect(classify({ clickIds: { ttclid: true } })).toEqual({ channel: "paid_social", source: "tiktok", campaign: "" });
  });

  it("fbclid alone is not an ad: a Facebook referrer is organic social, and none at all is organic social too", () => {
    expect(classify({ referrerHost: "l.facebook.com", clickIds: { fbclid: true } }).channel).toBe("organic_social");
    expect(classify({ clickIds: { fbclid: true } })).toEqual({ channel: "organic_social", source: "facebook", campaign: "" });
    // but with another referrer it is that referrer, and from our own host it is direct
    expect(classify({ referrerHost: "blog.example.no", clickIds: { fbclid: true } }).channel).toBe("referral");
    expect(classify({ referrerHost: "demo.kaizen.shop", clickIds: { fbclid: true } }).channel).toBe("direct");
  });

  it("a tagged email stays email even with a click id", () => {
    expect(classify({ utmMedium: "email", clickIds: { gclid: true } }).channel).toBe("email");
  });

  it("an unknown tagged medium beats a click id's absence but not its presence", () => {
    expect(classify({ utmMedium: "banner", clickIds: { gclid: true } }).channel).toBe("paid_search");
  });
});

describe("classifyChannel: utm_source without a medium", () => {
  it.each<[string, Channel]>([
    ["google", "organic_search"],
    ["Bing", "organic_search"],
    ["facebook", "organic_social"],
    ["fb", "organic_social"],
    ["instagram", "organic_social"],
    ["newsletter", "email"],
    ["mailchimp", "email"],
    ["Klaviyo", "email"],
    ["some-blog", "other"],
  ])("source %s is %s", (utmSource, channel) => {
    expect(classify({ utmSource }).channel).toBe(channel);
  });

  it("goes by the tag, not the referrer, once the owner has tagged", () => {
    expect(classify({ utmSource: "partnerx", referrerHost: "google.com" }).channel).toBe("other");
  });
});

describe("classifyChannel: referrer", () => {
  it("is direct with no referrer, our own host (and its subdomains), or garbage", () => {
    expect(classify({}).channel).toBe("direct");
    expect(classify({ referrerHost: null }).channel).toBe("direct");
    expect(classify({ referrerHost: "" }).channel).toBe("direct");
    expect(classify({ referrerHost: "demo.kaizen.shop" }).channel).toBe("direct");
    expect(classify({ referrerHost: "https://DEMO.kaizen.shop/s/demo/no" }).channel).toBe("direct");
    expect(classify({ referrerHost: "m.minbutikk.no" }).channel).toBe("direct");
    expect(classify({ referrerHost: "checkout.minbutikk.no" }).channel).toBe("direct");
    expect(classify({ referrerHost: "not a host" }).channel).toBe("direct");
    expect(classify({ referrerHost: "[::1]" }).channel).toBe("direct");
    expect(classify({ referrerHost: 12 as unknown as string }).channel).toBe("direct");
  });

  it("another store on the platform is a referral, not our own host", () => {
    expect(classify({ referrerHost: "other.kaizen.shop" })).toEqual({ channel: "referral", source: "other.kaizen.shop", campaign: "" });
  });

  it("a host that only ends like ours is not ours", () => {
    expect(classify({ referrerHost: "evil-demo.kaizen.shop" }).channel).toBe("referral");
    expect(classify({ referrerHost: "minbutikk.no.evil.com" }).channel).toBe("referral");
  });

  it("our own host is matched in any spelling, international names included", () => {
    expect(classify({ ownHosts: ["Bücher.no"], referrerHost: "https://www.xn--bcher-kva.no/x" }).channel).toBe("direct");
    expect(classify({ ownHosts: ["", "not a host", "demo.kaizen.shop"], referrerHost: "demo.kaizen.shop" }).channel).toBe("direct");
    expect(classify({ ownHosts: [], referrerHost: "demo.kaizen.shop" }).channel).toBe("referral");
  });

  it("search engines are organic search, named by engine", () => {
    for (const [host, source] of [
      ["www.google.no", "google"],
      ["google.com", "google"],
      ["www.bing.com", "bing"],
      ["duckduckgo.com", "duckduckgo"],
      ["www.ecosia.org", "ecosia"],
      ["search.yahoo.com", "yahoo"],
      ["yandex.ru", "yandex"],
      ["startpage.com", "startpage"],
      ["search.brave.com", "brave"],
      ["kagi.com", "kagi"],
    ]) {
      expect(classify({ referrerHost: host }), host).toEqual({ channel: "organic_search", source, campaign: "" });
    }
  });

  it("social networks are organic social, named by network", () => {
    for (const [host, source] of [
      ["l.facebook.com", "facebook"],
      ["m.facebook.com", "facebook"],
      ["facebook.com", "facebook"],
      ["l.instagram.com", "instagram"],
      ["t.co", "twitter"],
      ["twitter.com", "twitter"],
      ["x.com", "twitter"],
      ["www.linkedin.com", "linkedin"],
      ["lnkd.in", "linkedin"],
      ["www.tiktok.com", "tiktok"],
      ["no.pinterest.com", "pinterest"],
      ["www.youtube.com", "youtube"],
      ["out.reddit.com", "reddit"],
    ]) {
      expect(classify({ referrerHost: host }), host).toEqual({ channel: "organic_social", source, campaign: "" });
    }
  });

  it("a webmail referrer is email", () => {
    expect(classify({ referrerHost: "mail.google.com" })).toEqual({ channel: "email", source: "gmail", campaign: "" });
    expect(classify({ referrerHost: "android-app://com.google.android.gm" }).channel).toBe("email");
    expect(classify({ referrerHost: "mail.yahoo.com" }).channel).toBe("email");
  });

  it("any other host is a referral, named by its host", () => {
    expect(classify({ referrerHost: "www.blog.example.no" })).toEqual({ channel: "referral", source: "blog.example.no", campaign: "" });
    expect(classify({ referrerHost: "docs.google.com" }).channel).toBe("referral");
  });
});

describe("classifyChannel: source and campaign", () => {
  it("prefers the tag for the source, tidied", () => {
    expect(classify({ utmSource: "  Newsletter ", utmMedium: "email", utmCampaign: "Spring_Sale" })).toEqual({ channel: "email", source: "newsletter", campaign: "spring_sale" });
    expect(classify({ utmSource: "Facebook", utmMedium: "cpc", referrerHost: "l.facebook.com", utmCampaign: "Q4" })).toEqual({ channel: "paid_social", source: "facebook", campaign: "q4" });
  });

  it("falls back to the referrer's name, then the click id's platform, then nothing", () => {
    expect(classify({ utmMedium: "social", referrerHost: "l.instagram.com" }).source).toBe("instagram");
    expect(classify({ utmMedium: "cpc", clickIds: { gclid: true } }).source).toBe("google");
    expect(classify({ utmMedium: "email" }).source).toBe("");
    expect(classify({ utmMedium: "affiliate", referrerHost: "demo.kaizen.shop" }).source).toBe("");
  });

  it("direct has no source, but keeps a campaign tag", () => {
    expect(classify({})).toEqual({ channel: "direct", source: "", campaign: "" });
  });

  it("never throws on odd input", () => {
    const odd = { ownHosts: undefined as unknown as string[], referrerHost: {} as unknown as string, utmSource: 5 as unknown as string, utmMedium: [] as unknown as string, utmCampaign: null };
    expect(() => classifyChannel(odd)).not.toThrow();
    expect(classifyChannel(odd).channel).toBe("direct");
  });

  it("always answers with a channel of the shared list", () => {
    const keys = CHANNELS.map((c) => c.key) as string[];
    for (const utmMedium of [undefined, "cpc", "email", "social", "weird"]) {
      for (const referrerHost of [undefined, "google.com", "x.com", "blog.no", "demo.kaizen.shop"]) {
        expect(keys).toContain(classify({ utmMedium, referrerHost }).channel);
      }
    }
  });
});

describe("landingKind", () => {
  it("reads a product on the platform and on a store's own host", () => {
    expect(landingKind("/s/demo/no/p/blue-shirt")).toEqual({ kind: "product", handle: "blue-shirt" });
    expect(landingKind("/no/p/blue-shirt")).toEqual({ kind: "product", handle: "blue-shirt" });
    expect(landingKind("/no-en/p/blue-shirt/")).toEqual({ kind: "product", handle: "blue-shirt" });
    expect(landingKind("/s/demo/no-en-eur/p/blue-shirt")).toEqual({ kind: "product", handle: "blue-shirt" });
  });

  it("tolerates A/B versions after the market", () => {
    expect(landingKind("/no~3fa9c1d2b/p/blue-shirt")).toEqual({ kind: "product", handle: "blue-shirt" });
    expect(landingKind("/s/demo/no-en~3fa9c1d2b_7b21aa90c/p/x")).toEqual({ kind: "product", handle: "x" });
    expect(landingKind("/no~3fa9c1d2b/cart").kind).toBe("cart");
    expect(landingKind("/no~oddtoken/p/x").kind).toBe("other");
  });

  it("ignores the query and fragment, and decodes the handle", () => {
    expect(landingKind("/no/p/blue-shirt?utm_source=x&variant=2#reviews")).toEqual({ kind: "product", handle: "blue-shirt" });
    expect(landingKind("/no/p/caf%C3%A9")).toEqual({ kind: "product", handle: "café" });
    expect(landingKind("/no/p/100%")).toEqual({ kind: "product", handle: "100%" });
    expect(landingKind("/no/p/x/anything/after").handle).toBe("x");
  });

  it("knows the cart, checkout and order pages", () => {
    expect(landingKind("/s/demo/no/cart")).toEqual({ kind: "cart", handle: null });
    expect(landingKind("/se/checkout")).toEqual({ kind: "checkout", handle: null });
    expect(landingKind("/s/demo/dk/order/9f2c")).toEqual({ kind: "order", handle: null });
    expect(landingKind("/no/cart/restore").kind).toBe("cart");
  });

  it("is other for everything else", () => {
    for (const path of ["/", "", "/s", "/s/demo", "/s/demo/no", "/no", "/no/products", "/no/search", "/no/blog/hello", "/admin/demo/analytics", "/p/blue-shirt", "/no/p", "/no/p/", "/no/order", "/xx1/p/a", "/NOR/p/a", "/s/demo/no/account"]) {
      expect(landingKind(path), path).toEqual({ kind: "other", handle: null });
    }
  });

  it("takes the market in any case, and refuses a handle that is absurd", () => {
    expect(landingKind("/NO/p/x").kind).toBe("product");
    expect(landingKind(`/no/p/${"a".repeat(201)}`).kind).toBe("other");
  });

  it("never throws on what is not a path", () => {
    for (const bad of [null, undefined, 5, {}, "///", "/%E0%A4%A", "\u0000"]) {
      expect(() => landingKind(bad)).not.toThrow();
    }
    expect(landingKind(null)).toEqual({ kind: "other", handle: null });
  });
});

describe("funnel", () => {
  const full = funnel({ sessions: 1000, productViewers: 600, carts: 120, checkouts: 60, purchases: 30 });

  it("keeps every stage with its share of the first and of the one before", () => {
    expect(full.stages.map((s) => s.count)).toEqual([1000, 600, 120, 60, 30]);
    expect(full.stages.map((s) => s.fromFirst)).toEqual([1, 0.6, 0.12, 0.06, 0.03]);
    expect(full.stages.map((s) => s.fromPrevious)).toEqual([null, 0.6, 0.2, 0.5, 0.5]);
    expect(full.stages.map((s) => s.label)[0]).toBe("Visits");
    expect(full.clampedStages).toEqual([]);
    expect(full.notes).toEqual([]);
  });

  it("works out the named rates", () => {
    expect(full.productViewRate).toBe(0.6);
    expect(full.addToCartRate).toBe(0.12);
    expect(full.cartAbandonment).toBe(0.75); // 1 - 30/120
    expect(full.checkoutAbandonment).toBe(0.5); // 1 - 30/60
    expect(full.purchaseConversion).toBe(0.03);
  });

  it("cuts a stage that is larger than the one before, and says so", () => {
    const f = funnel({ sessions: 100, productViewers: 40, carts: 10, checkouts: 12, purchases: 3 });
    expect(f.stages[3]).toMatchObject({ count: 10, raw: 12, clamped: true, fromPrevious: 1 });
    expect(f.clampedStages).toEqual(["checkouts"]);
    expect(f.notes).toEqual(["Reached checkout (12) is more than Added to cart (10), so it is shown as 10."]);
    expect(f.checkoutAbandonment).toBe(0.7);
    expect(f.cartAbandonment).toBe(0.7);
  });

  it("cuts down a chain: everything after the first overshoot is held to it", () => {
    const f = funnel({ sessions: 10, productViewers: 20, carts: 15, checkouts: 15, purchases: 20 });
    expect(f.stages.map((s) => s.count)).toEqual([10, 10, 10, 10, 10]);
    expect(f.clampedStages).toEqual(["productViewers", "carts", "checkouts", "purchases"]);
    expect(f.purchaseConversion).toBe(1);
    expect(f.cartAbandonment).toBe(0);
  });

  it("has no rates without visits, and never divides by zero", () => {
    const none = funnel({ sessions: 0, productViewers: 0, carts: 0, checkouts: 0, purchases: 0 });
    expect(none.stages.map((s) => s.fromFirst)).toEqual([null, null, null, null, null]);
    expect(none.productViewRate).toBeNull();
    expect(none.addToCartRate).toBeNull();
    expect(none.cartAbandonment).toBeNull();
    expect(none.checkoutAbandonment).toBeNull();
    expect(none.purchaseConversion).toBeNull();
  });

  it("with carts but none that checked out, abandonment is total", () => {
    const f = funnel({ sessions: 50, productViewers: 20, carts: 5, checkouts: 0, purchases: 0 });
    expect(f.cartAbandonment).toBe(1);
    expect(f.checkoutAbandonment).toBeNull();
    expect(f.stages[4].fromPrevious).toBeNull();
  });

  it("treats an unknown stage as unknown, not as 0, and holds later stages to the last known", () => {
    const f = funnel({ sessions: null, productViewers: null, carts: null, checkouts: null, purchases: 12 });
    expect(f.stages.map((s) => s.count)).toEqual([null, null, null, null, 12]);
    expect(f.purchaseConversion).toBeNull();
    expect(f.cartAbandonment).toBeNull();
    const partly = funnel({ sessions: 100, productViewers: undefined, carts: 30, checkouts: 10, purchases: 5 });
    expect(partly.stages[1].count).toBeNull();
    expect(partly.stages[2]).toMatchObject({ count: 30, fromPrevious: null, fromFirst: 0.3 });
    expect(partly.productViewRate).toBeNull();
    expect(partly.addToCartRate).toBe(0.3);
    const over = funnel({ sessions: 20, productViewers: null, carts: 30, checkouts: 0, purchases: 0 });
    expect(over.stages[2]).toMatchObject({ count: 20, raw: 30, clamped: true });
    expect(over.notes[0]).toBe("Added to cart (30) is more than Visits (20), so it is shown as 20.");
  });

  it("cleans counts: negatives are 0, fractions round, non-numbers are unknown", () => {
    const f = funnel({ sessions: 10.4, productViewers: -3, carts: Number.NaN, checkouts: Infinity, purchases: 0 });
    expect(f.stages.map((s) => s.count)).toEqual([10, 0, null, null, 0]);
  });
});

describe("channelTable", () => {
  const rows: ChannelInput[] = [
    { channel: "direct", sessions: 500, orders: 20, revenueMinor: 400_000, newCustomers: 5, spendMinor: 0, contributionBeforeMarketingMinor: 160_000 },
    { channel: "paid_search", sessions: 300, orders: 12, revenueMinor: 240_000, newCustomers: 10, spendMinor: 60_000, contributionBeforeMarketingMinor: 96_000 },
    { channel: "paid_social", sessions: 200, orders: 2, revenueMinor: 40_000, newCustomers: 2, spendMinor: 50_000, contributionBeforeMarketingMinor: 16_000 },
    { channel: UNKNOWN_CHANNEL, sessions: null, orders: 6, revenueMinor: 120_000, newCustomers: 3, spendMinor: 0, contributionBeforeMarketingMinor: 48_000 },
  ];
  const t = channelTable(rows);
  const byKey = (k: string) => t.rows.find((r) => r.channel === k)!;

  it("derives each channel's figures", () => {
    const search = byKey("paid_search");
    expect(search.label).toBe("Paid search");
    expect(search.conversion).toBe(0.04);
    expect(search.aov).toBe(20_000);
    expect(search.roas).toBe(4);
    expect(search.cac).toBe(6000);
    expect(search.profitRoas).toBe(1.6);
    const social = byKey("paid_social");
    expect(social.roas).toBe(0.8);
    expect(social.cac).toBe(25_000);
    expect(social.profitRoas).toBe(0.32);
  });

  it("has no ROAS, CAC or profit ROAS for a channel with no spend, and no conversion for one with no sessions", () => {
    const direct = byKey("direct");
    expect(direct.roas).toBeNull();
    expect(direct.cac).toBeNull();
    expect(direct.profitRoas).toBeNull();
    expect(direct.conversion).toBe(0.04);
    const unknown = byKey(UNKNOWN_CHANNEL);
    expect(unknown.label).toBe("Unknown");
    expect(unknown.conversion).toBeNull();
    expect(unknown.sessions).toBeNull();
  });

  it("adds a blended row from the totals, with the blended CAC and ROAS", () => {
    const b = t.blended;
    expect(b.channel).toBe("blended");
    expect(b.label).toBe("Blended");
    expect(b.sessions).toBe(1000);
    expect(b.orders).toBe(40);
    expect(b.revenueMinor).toBe(800_000);
    expect(b.spendMinor).toBe(110_000);
    expect(b.newCustomers).toBe(20);
    expect(b.contributionBeforeMarketingMinor).toBe(320_000);
    expect(b.conversion).toBe(0.04);
    expect(b.aov).toBe(20_000);
    // ROAS (blended): only the channels with ad spend, paid search and paid social: (240 000 + 40 000) / (60 000 + 50 000).
    expect(b.roas).toBeCloseTo(280_000 / 110_000, 10);
    expect(b.cac).toBe(5500);
    // And profit ROAS likewise: (96 000 + 16 000) / 110 000.
    expect(b.profitRoas).toBeCloseTo(112_000 / 110_000, 10);
    expect(b.revenueShare).toBe(1);
  });

  it("counts direct, organic and unknown sales in MER, never in ROAS", () => {
    expect(t.spendChannels).toEqual({ channels: 2, revenueMinor: 280_000, spendMinor: 110_000, contributionBeforeMarketingMinor: 112_000 });
    // MER: every sale divided by every ad krone, 800 000 / 110 000.
    expect(t.mer).toBeCloseTo(800_000 / 110_000, 10);
    expect(t.mer!).toBeGreaterThan(t.blended.roas!);
    // Without direct and unknown sales the two are the same thing.
    const paidOnly = channelTable(rows.filter((r) => r.spendMinor > 0));
    expect(paidOnly.mer).toBeCloseTo(paidOnly.blended.roas!, 10);
  });

  it("leaves each channel's own ROAS as revenue over its spend", () => {
    expect(byKey("paid_search").roas).toBe(4);
    expect(byKey("paid_social").roas).toBe(0.8);
  });

  it("has no blended ROAS or MER without ad spend, however much was sold", () => {
    const free = channelTable([{ channel: "direct", sessions: 10, orders: 5, revenueMinor: 100_000, newCustomers: 3, spendMinor: 0, contributionBeforeMarketingMinor: 40_000 }]);
    expect(free.blended.roas).toBeNull();
    expect(free.blended.profitRoas).toBeNull();
    expect(free.mer).toBeNull();
    expect(free.spendChannels.channels).toBe(0);
    expect(free.spendChannels.contributionBeforeMarketingMinor).toBeNull();
  });

  it("gives the blended profit ROAS from the spend channels even where another channel's costs are unknown", () => {
    const mixed = channelTable([
      { channel: "paid_search", sessions: 10, orders: 4, revenueMinor: 80_000, newCustomers: 3, spendMinor: 10_000, contributionBeforeMarketingMinor: 30_000 },
      { channel: "email", sessions: 10, orders: 4, revenueMinor: 80_000, newCustomers: 3, spendMinor: 0, contributionBeforeMarketingMinor: null },
    ]);
    expect(mixed.blended.profitRoas).toBe(3);
    // The spend channel's own costs unknown: no profit ROAS.
    const unknownSpend = channelTable([{ channel: "paid_search", sessions: 10, orders: 4, revenueMinor: 80_000, newCustomers: 3, spendMinor: 10_000, contributionBeforeMarketingMinor: null }]);
    expect(unknownSpend.blended.profitRoas).toBeNull();
    expect(unknownSpend.blended.roas).toBe(8);
  });

  it("gives each channel its share of revenue and sorts by revenue", () => {
    expect(t.rows.map((r) => r.channel)).toEqual(["direct", "paid_search", UNKNOWN_CHANNEL, "paid_social"]);
    expect(byKey("direct").revenueShare).toBe(0.5);
    expect(t.rows.reduce((s, r) => s + (r.revenueShare ?? 0), 0)).toBeCloseTo(1, 10);
  });

  it("breaks ties by spend, then by the channels' own order", () => {
    const tie = channelTable([
      { channel: "email", sessions: 10, orders: 1, revenueMinor: 1000, newCustomers: 0, spendMinor: 0, contributionBeforeMarketingMinor: null },
      { channel: "direct", sessions: 10, orders: 1, revenueMinor: 1000, newCustomers: 0, spendMinor: 0, contributionBeforeMarketingMinor: null },
      { channel: "paid_search", sessions: 10, orders: 1, revenueMinor: 1000, newCustomers: 0, spendMinor: 500, contributionBeforeMarketingMinor: null },
      { channel: "zzz", sessions: 10, orders: 1, revenueMinor: 1000, newCustomers: 0, spendMinor: 0, contributionBeforeMarketingMinor: null },
    ]);
    expect(tie.rows.map((r) => r.channel)).toEqual(["paid_search", "direct", "email", "zzz"]);
  });

  it("adds rows of the same channel (per campaign) into one", () => {
    const merged = channelTable([
      { channel: "paid_search", sessions: 100, orders: 4, revenueMinor: 80_000, newCustomers: 3, spendMinor: 10_000, contributionBeforeMarketingMinor: 30_000 },
      { channel: "paid_search", sessions: null, orders: 2, revenueMinor: 20_000, newCustomers: 1, spendMinor: 5000, contributionBeforeMarketingMinor: null },
    ]);
    expect(merged.rows).toHaveLength(1);
    expect(merged.rows[0]).toMatchObject({ sessions: 100, orders: 6, revenueMinor: 100_000, newCustomers: 4, spendMinor: 15_000, contributionBeforeMarketingMinor: 30_000 });
    expect(merged.rows[0].cac).toBe(3750);
  });

  it("keeps unknown costs unknown, in a channel and in the total", () => {
    const noCosts = channelTable([{ channel: "email", sessions: 10, orders: 1, revenueMinor: 1000, newCustomers: 1, spendMinor: 200, contributionBeforeMarketingMinor: null }]);
    expect(noCosts.rows[0].profitRoas).toBeNull();
    expect(noCosts.blended.contributionBeforeMarketingMinor).toBeNull();
    expect(noCosts.blended.profitRoas).toBeNull();
    expect(noCosts.blended.roas).toBe(5);
  });

  it("copes with an empty table and with zeros", () => {
    const empty = channelTable([]);
    expect(empty.rows).toEqual([]);
    expect(empty.blended).toMatchObject({ sessions: null, orders: 0, conversion: null, aov: null, roas: null, cac: null, profitRoas: null, revenueShare: null });
    const zero = channelTable([{ channel: "direct", sessions: 0, orders: 0, revenueMinor: 0, newCustomers: 0, spendMinor: 0, contributionBeforeMarketingMinor: 0 }]);
    expect(zero.rows[0]).toMatchObject({ conversion: null, aov: null, roas: null, cac: null, revenueShare: null });
  });

  it("spend with no new customers has a ROAS but no CAC", () => {
    const t2 = channelTable([{ channel: "paid_social", sessions: 50, orders: 1, revenueMinor: 9000, newCustomers: 0, spendMinor: 3000, contributionBeforeMarketingMinor: 3000 }]);
    expect(t2.rows[0].roas).toBe(3);
    expect(t2.rows[0].cac).toBeNull();
    expect(t2.rows[0].profitRoas).toBe(1);
  });

  it("rounds AOV and CAC to whole minor units and ignores non-finite figures", () => {
    const t3 = channelTable([{ channel: "email", sessions: 3, orders: 3, revenueMinor: 1000, newCustomers: 3, spendMinor: 1000, contributionBeforeMarketingMinor: Number.NaN }]);
    expect(t3.rows[0].aov).toBe(333);
    expect(t3.rows[0].cac).toBe(333);
    expect(t3.rows[0].contributionBeforeMarketingMinor).toBe(0);
  });

  it("labels channels, the unknown one, and anything else as it is", () => {
    expect(channelLabel("organic_social")).toBe("Organic social");
    expect(channelLabel(UNKNOWN_CHANNEL)).toBe("Unknown");
    expect(channelLabel("mystery")).toBe("mystery");
  });
});

describe("ltvToCac", () => {
  it("is the ratio", () => {
    expect(ltvToCac(30_000, 10_000)).toBe(3);
    expect(ltvToCac(5000, 10_000)).toBe(0.5);
    expect(ltvToCac(-5000, 10_000)).toBe(-0.5);
    expect(ltvToCac(0, 10_000)).toBe(0);
  });

  it("is null when either is unknown or CAC is not above zero", () => {
    expect(ltvToCac(null, 10_000)).toBeNull();
    expect(ltvToCac(30_000, null)).toBeNull();
    expect(ltvToCac(undefined, undefined)).toBeNull();
    expect(ltvToCac(30_000, 0)).toBeNull();
    expect(ltvToCac(30_000, -1)).toBeNull();
    expect(ltvToCac(Number.NaN, 5)).toBeNull();
    expect(ltvToCac(5, Number.POSITIVE_INFINITY)).toBeNull();
  });
});

describe("the Staff-made row of the channel table (D173)", () => {
  const input = (channel: string, over: Partial<ChannelInput> = {}): ChannelInput => ({
    channel,
    sessions: 100,
    orders: 5,
    revenueMinor: 50_000,
    newCustomers: 2,
    spendMinor: 0,
    contributionBeforeMarketingMinor: 20_000,
    ...over,
  });

  it("is no place visitors come from: labelled, with no sessions to know, and never a channel to compare or spend on", () => {
    expect(channelLabel(STAFF_CHANNEL)).toBe("Staff-made");
    expect(isNotAChannel(STAFF_CHANNEL)).toBe(true);
    expect(isNotAChannel(UNKNOWN_CHANNEL)).toBe(true);
    expect(isNotAChannel("direct")).toBe(false);
    expect(CHANNELS.some((c) => (c.key as string) === STAFF_CHANNEL)).toBe(false);
  });

  it("keeps the table's revenue whole and leaves the staff row out of every rate: no conversion of its own, and the blended one counts the others' orders only", () => {
    const t = channelTable([input("direct", { sessions: 100, orders: 5 }), input("email", { sessions: 100, orders: 5 }), input(STAFF_CHANNEL, { sessions: null, orders: 3, revenueMinor: 30_000 })]);
    const staff = t.rows.find((r) => r.channel === STAFF_CHANNEL)!;
    expect(staff.label).toBe("Staff-made");
    expect(staff.conversion).toBeNull();
    expect(staff.aov).toBe(10_000);
    // All revenue is in the table, so the shares add up.
    expect(t.blended.revenueMinor).toBe(130_000);
    expect(t.rows.reduce((s, r) => s + (r.revenueShare ?? 0), 0)).toBeCloseTo(1, 10);
    // 10 checkout orders over 200 sessions, not 13.
    expect(t.blended.orders).toBe(13);
    expect(t.blended.conversion).toBe(10 / 200);
  });

  it("is the same table as before when no order was staff-made", () => {
    const rows = [input("direct"), input("email", { orders: 7, sessions: 140 })];
    expect(channelTable(rows).blended.conversion).toBe(12 / 240);
  });
});
