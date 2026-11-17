import { describe, expect, it } from "vitest";

import { heatmapsEn } from "./admin-messages/heatmaps.en";
import { heatmapsNb } from "./admin-messages/heatmaps.nb";
import { askText, deviceRows, heatKeys, pagePaths, partLinks, partOfAnchor, placeOfKey, signalPlan, speedRowOf, speedVerdict, stripText, type SignalFacts } from "./page-signals";
import { newBlock, newRow } from "./page-rows";
import type { SpeedMetric } from "./speed";
import { placeOfPath } from "./visit-record";

const words = heatmapsEn.strip;
const nbsp = " ";

const none: SignalFacts = {
  measuring: { visits: false, heatmaps: false },
  productViews: null,
  orders: null,
  heat: null,
  speed: null,
  test: null,
  recordings: null,
};

const figures = (lcp: number, n = 25): Record<SpeedMetric, { n: number; p75: number | null }> => ({
  lcp: { n, p75: lcp },
  inp: { n, p75: 120 },
  cls: { n, p75: 40 },
  ttfb: { n, p75: 300 },
});

const heat = (views: number, frustrated: number, reachedHalf: number): NonNullable<SignalFacts["heat"]> => ({
  total: { views, frustrated, reachedHalf },
  devices: { mobile: { views, frustrated, reachedHalf }, tablet: { views: 0, frustrated: 0, reachedHalf: 0 }, desktop: { views: 0, frustrated: 0, reachedHalf: 0 } },
  topKey: "/no/om-oss",
});

describe("the heat keys of a page, an article and a product (E2.3)", () => {
  it("gives a page its address in every country, as the beacons keep it", () => {
    expect(signalPlan({ type: "page", slug: "om-oss" }, ["NO", "SE", "NO"])).toEqual({ keys: ["/no/om-oss", "/se/om-oss"], kind: "page" });
  });

  it("puts a page's places first: the front page, All products, the blog and search pages", () => {
    expect(pagePaths({ type: "page", slug: "home", front: true })).toEqual(["", "/home"]);
    expect(signalPlan({ type: "page", slug: "home", front: true }, ["NO"])).toEqual({ keys: ["/no", "/no/home"], kind: "home" });
    expect(signalPlan({ type: "page", slug: "alt", products: true }, ["NO"])).toEqual({ keys: ["/no/products", "/no/alt"], kind: "list" });
    expect(signalPlan({ type: "page", slug: "blog-archive", roles: ["blog"] }, ["NO"]).keys).toEqual(["/no/blog", "/no/blog-archive"]);
    expect(signalPlan({ type: "page", slug: "search-page", roles: ["search"] }, ["NO"]).keys[0]).toBe("/no/search");
  });

  it("measures no working page, nested page or page of the category and tag pages by a key of its own", () => {
    // The cart's page is drawn at /cart, which is never measured; its own address is a page like any.
    expect(signalPlan({ type: "page", slug: "handlekurv", roles: ["cart"] }, ["NO"]).keys).toEqual(["/no/handlekurv"]);
    expect(signalPlan({ type: "page", slug: "projects/project-a" }, ["NO"])).toEqual({ keys: [], kind: null });
    expect(signalPlan({ type: "page", slug: "kategori", roles: ["category"] }, ["NO"])).toEqual({ keys: [], kind: "category" });
  });

  it("keys an article of the first blog only: the others are at /blogs/{handle}, which no beacon keeps", () => {
    expect(signalPlan({ type: "article", slug: "spring-news" }, ["NO"])).toEqual({ keys: ["/no/blog/spring-news"], kind: "page" });
    expect(signalPlan({ type: "article", slug: "spring-news", blog: "/blog" }, ["NO"]).keys).toEqual(["/no/blog/spring-news"]);
    expect(signalPlan({ type: "article", slug: "spring-news", blog: "/blogs/recipes" }, ["NO"])).toEqual({ keys: [], kind: null });
  });

  it("keys a product by its handle, letters outside ASCII as the browser decodes them", () => {
    expect(signalPlan({ type: "product", handle: "mug" }, ["NO", "DK"])).toEqual({ keys: ["/no/p/mug", "/dk/p/mug"], kind: "product" });
    expect(heatKeys(["/p/blåbær-krus"], ["NO"])).toEqual(["/no/p/blåbær-krus"]);
  });

  it("gives a store that sells in one country (D181) the keys its addresses without a country are kept as", () => {
    const address = { home: "no", marketless: true, languages: ["en"], currencies: ["eur"], keptLanguages: [], keptCurrencies: [], countries: ["no"] };
    const [key] = heatKeys(["/p/mug"], ["NO"]);
    expect(placeOfPath("/p/mug", "demo", ["NO"], address)?.landing).toBe(key);
    expect(placeOfPath("/en/om-oss", "demo", ["NO"], address)?.landing).toBe(signalPlan({ type: "page", slug: "om-oss" }, ["NO"]).keys[0]);
    expect(placeOfPath("/", "demo", ["NO"], address)?.landing).toBe(signalPlan({ type: "page", slug: "home", front: true }, ["NO"]).keys[0]);
  });
});

describe("back from a heat key to the page and the part (the heatmap's Edit this part)", () => {
  it("knows what draws each kind of key", () => {
    expect(placeOfKey("/no")).toEqual({ place: "front" });
    expect(placeOfKey("/no/products")).toEqual({ place: "products" });
    expect(placeOfKey("/no/blog")).toEqual({ place: "role", role: "blog" });
    expect(placeOfKey("/no/category/cups")).toEqual({ place: "role", role: "category" });
    expect(placeOfKey("/no/om-oss")).toEqual({ place: "page", slug: "om-oss" });
    expect(placeOfKey("/no/blog/spring-news")).toEqual({ place: "article", slug: "spring-news" });
    expect(placeOfKey("/se/p/blåbær-krus")).toEqual({ place: "product", handle: "blåbær-krus" });
    expect(placeOfKey("(other)")).toBeNull();
    expect(placeOfKey("/no/a/b/c")).toBeNull();
  });

  it("goes back from every key the strip makes", () => {
    for (const what of [{ type: "page", slug: "om-oss" }, { type: "page", slug: "home", front: true }, { type: "article", slug: "x" }] as const) {
      expect(placeOfKey(signalPlan(what, ["NO"]).keys[0])).not.toBeNull();
    }
    expect(placeOfKey(signalPlan({ type: "product", handle: "mug" }, ["NO"]).keys[0])).toEqual({ place: "product", handle: "mug" });
  });

  it("finds the builder part of an anchor, a card's too, and none of a landmark", () => {
    const id = "0a1b2c3d-1111-4222-8333-444455556666";
    expect(partOfAnchor(id)).toBe(id);
    expect(partOfAnchor(`${id}/c3`)).toBe(id);
    expect(partOfAnchor("product-media")).toBe("product-media");
    expect(partOfAnchor("@header")).toBeNull();
    expect(partOfAnchor("@card:0:2")).toBeNull();
  });

  it("links a part the page has to its builder and its A/B test, as far as the person may", () => {
    let n = 0;
    const newId = () => `0a1b2c3d-1111-4222-8333-${String(++n).padStart(12, "0")}`;
    const row = newRow("1", newId);
    row.columns[0].blocks.push(newBlock("richText", newId));
    const block = row.columns[0].blocks[0].id;
    const page = { id: "p1", editHref: "/admin/demo/pages/p1", content: { rows: [row] }, testKind: "page" as const };
    const anchors = [row.id, `${block}/c1`, "@footer", "0a1b2c3d-1111-4222-8333-999999999999"];
    expect(partLinks("/admin/demo", page, anchors, { edit: true, test: true })).toEqual({
      [row.id]: { edit: `/admin/demo/pages/p1?part=${row.id}`, test: `/admin/demo/experiments/new?page=p1&kind=row&part=${row.id}` },
      [`${block}/c1`]: { edit: `/admin/demo/pages/p1?part=${block}`, test: `/admin/demo/experiments/new?page=p1&kind=block&part=${block}` },
    });
    expect(partLinks("/admin/demo", { ...page, testKind: null }, [row.id], { edit: true, test: true })).toEqual({ [row.id]: { edit: `/admin/demo/pages/p1?part=${row.id}` } });
    expect(partLinks("/admin/demo", page, [row.id], { edit: false, test: false })).toEqual({});
  });
});

describe("the speed of a kind of page", () => {
  it("rates a screen's figures from 20 page loads, at their worst", () => {
    const row = speedRowOf("product", "phone", 30, figures(2000));
    expect(row.cells.map((c) => c.rating)).toEqual(["good", "good", "good", "good"]);
    expect(speedVerdict([row])).toBe("good");
    expect(speedVerdict([row, speedRowOf("product", "computer", 30, figures(3000))])).toBe("improve");
    expect(speedVerdict([row, speedRowOf("product", "computer", 30, figures(5000))])).toBe("poor");
  });

  it("gives no verdict below 20 page loads", () => {
    const row = speedRowOf("page", "phone", 19, figures(9000, 19));
    expect(row.cells.every((c) => c.value === null && c.rating === null)).toBe(true);
    expect(speedVerdict([row])).toBeNull();
  });
});

describe("the strip's words", () => {
  it("says what to switch on when nothing is measured", () => {
    expect(stripText(none, words)).toEqual({ line: null, switchOn: "both" });
    expect(stripText({ ...none, measuring: { visits: true, heatmaps: false } }, words)).toEqual({ line: null, switchOn: "heatmaps" });
  });

  it("writes Homer's line: views, where visitors get stuck, how far they read and how it loads", () => {
    const facts: SignalFacts = {
      ...none,
      measuring: { visits: true, heatmaps: true },
      heat: heat(1240, 99, 570),
      speed: { kind: "page", rows: [speedRowOf("page", "phone", 40, figures(2000))] },
    };
    expect(stripText(facts, words)).toEqual({ line: `Last 30 days: 1${nbsp}240 views · 8 % met a dead or rage click · 46 % scrolled halfway · loads well`, switchOn: null });
  });

  it("gives a product's counted views and the share that ordered, and says a test is running", () => {
    const facts: SignalFacts = { ...none, measuring: { visits: true, heatmaps: false }, productViews: 400, orders: 9, test: { id: "t", name: "Bigger photos" } };
    expect(stripText(facts, words)).toEqual({ line: "Last 30 days: 400 views · 2.3 % ordered · an A/B test is running", switchOn: "heatmaps" });
  });

  it("gives no share from fewer page views than a map needs, and counts one view as one", () => {
    expect(stripText({ ...none, measuring: { visits: false, heatmaps: true }, heat: heat(1, 1, 0) }, words).line).toBe("Last 30 days: 1 view");
    expect(stripText({ ...none, measuring: { visits: false, heatmaps: true }, heat: heat(29, 29, 0) }, words).line).toBe("Last 30 days: 29 views");
  });

  it("keeps heat totals measured before heatmaps were switched off, and asks for nothing then", () => {
    expect(stripText({ ...none, measuring: { visits: true, heatmaps: false }, heat: heat(50, 5, 25) }, words)).toEqual({
      line: "Last 30 days: 50 views · 10 % met a dead or rage click · 50 % scrolled halfway",
      switchOn: null,
    });
  });

  it("gives Lisa the devices with views", () => {
    expect(deviceRows({ ...none, heat: heat(60, 6, 30) })).toEqual([{ device: "mobile", views: "60", stuck: "10 %", half: "50 %" }]);
    expect(deviceRows({ ...none, heat: heat(12, 6, 3) })).toEqual([{ device: "mobile", views: "12", stuck: null, half: null }]);
    expect(deviceRows(none)).toEqual([]);
  });

  it("asks the AI manager in the strip's own words, with the page key for its heatmap tools", () => {
    const text = askText("page", "About us", { ...none, measuring: { visits: true, heatmaps: true }, heat: heat(60, 6, 30) }, words);
    expect(text).toContain("“About us”");
    expect(text).toContain("Last 30 days: 60 views · 10 % met a dead or rage click");
    expect(text).toContain("/no/om-oss");
    expect(askText("product", "Mug", none, words)).toContain(words.nothing);
  });

  it("has every word in Norwegian", () => {
    expect(Object.keys(heatmapsNb.strip).sort()).toEqual(Object.keys(heatmapsEn.strip).sort());
    expect(stripText({ ...none, measuring: { visits: true, heatmaps: false }, productViews: 1, orders: 0 }, heatmapsNb.strip).line).toBe("Siste 30 dager: 1 visning · 0.0 % bestilte");
  });
});
