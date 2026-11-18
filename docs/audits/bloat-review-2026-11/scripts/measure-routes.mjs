#!/usr/bin/env node
// Measures what real pages of the production build send to a browser (bloat review, 11 Nov 2026).
//   node measure-routes.mjs <outDir> '{"product":"…","pageId":"…","themedProduct":"…","themedPage":"…"}'
// product and pageId: a product id and a page id of e2e-shop, for the admin's editors. themedProduct and themedPage: the handle of a
// product and the slug of a built page of e2e-orbit, the store on the Orbit theme that `pnpm seed:themed` makes before the build
// (bloat review step 1.6; its first product and its about page: andromeda and about on 18 November 2026).
// moneyState, moneyCart and moneyCheckout (bloat review step 1.7, all three or none): a browser state file and the paths of a cart with
// two lines and of its checkout at the payment step, which `E2E_MEASURE=1 pnpm exec playwright test e2e/performance.spec.ts -g 'money
// path'` makes (it saves e2e/.auth/money.json once the cart has two lines and prints `[money] address cart <path>` and `[money] address
// checkout <path>`). Those pages answer only on a server with Kaizena Flow's test keys and the Stripe stand-in: run this script with
// BASE_URL at the e2e's second server (playwright.config.ts, http://localhost:3001; started by hand as the config starts it, so it
// outlives the spec, which reuses it locally), while the order the spec placed still waits (CHECKOUT_MINUTES). This script does not
// route js.stripe.com: the checkout asks Stripe's real script itself.
// For each page: a cold browser (empty cache) against a warm server; every response's bytes as transferred (the server gzips)
// and decoded; which scripts and styles were actually run or matched by the time the page was idle (V8 and CSS coverage);
// what the document is made of (markup, inline RSC payload, inline styles); and what the page asks for after it has loaded.
// With {"slow":true} in the JSON argument (bloat review step 1.14), eight pages (store-home, store-product, store-products, store-cart-empty
// on a phone; admin-home, admin-orders, admin-product-editor, admin-page-builder signed in, on a desktop) are loaded once more with the
// CPU slowed four times, and each of their records gets a `slow` key: { cpu, blockingMs (long tasks over 50 ms, the excess summed),
// lcpMs, runBytes (the script bytes run by idle) }, the figures `e2e/run-bytes.ts` holds. Without it the output is as it was.
import { createRequire } from "node:module";
import { mkdirSync, writeFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { join } from "node:path";

const require = createRequire(process.cwd() + "/");
const { chromium } = require("playwright-core");

const out = process.argv[2];
mkdirSync(join(out, "html"), { recursive: true });
const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const REPO = process.cwd();
const PHONE = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 };
const DESK = { viewport: { width: 1440, height: 900 } };

const args = JSON.parse(process.argv[3] ?? "{}");
const product = args.product, pageId = args.pageId;
const themedProduct = args.themedProduct ?? "andromeda", themedPage = args.themedPage ?? "about";

const SLOW = new Set(["store-home", "store-product", "store-products", "store-cart-empty", "admin-home", "admin-orders", "admin-product-editor", "admin-page-builder"]);
const SLOW_CPU = 4;

const PAGES = [
  // The demo store, as a shopper on a phone.
  { name: "store-home", group: "storefront", path: "/s/demo/no", ...PHONE },
  { name: "store-product", group: "storefront", path: "/s/demo/no/p/demo-keramikkopp", ...PHONE },
  { name: "store-product-booking", group: "storefront", path: "/s/demo/no/p/demo-hytte", ...PHONE },
  { name: "store-category", group: "storefront", path: "/s/demo/no/category/belysning", ...PHONE },
  { name: "store-products", group: "storefront", path: "/s/demo/no/products", ...PHONE },
  { name: "store-page", group: "storefront", path: "/s/demo/no/om-oss", ...PHONE },
  { name: "store-search", group: "storefront", path: "/s/demo/no/search?q=lampe", ...PHONE },
  { name: "store-blog-post", group: "storefront", path: "/s/demo/no/blog/nye-produkter", ...PHONE },
  { name: "store-cart-empty", group: "storefront", path: "/s/demo/no/cart", ...PHONE },
  { name: "store-checkout-empty", group: "storefront", path: "/s/demo/no/checkout", ...PHONE },
  { name: "store-account", group: "storefront", path: "/s/demo/no/account", ...PHONE },
  { name: "store-wishlist", group: "storefront", path: "/s/demo/no/wishlist", ...PHONE },
  // A store on a launch theme (e2e-orbit, bloat review step 1.6), as a shopper on a phone.
  { name: "themed-home", group: "storefront", path: "/s/e2e-orbit/no", ...PHONE },
  { name: "themed-product", group: "storefront", path: `/s/e2e-orbit/no/p/${themedProduct}`, ...PHONE },
  { name: "themed-products", group: "storefront", path: "/s/e2e-orbit/no/products", ...PHONE },
  { name: "themed-page", group: "storefront", path: `/s/e2e-orbit/no/${themedPage}`, ...PHONE },
  // Kaizena Flow's own site.
  { name: "site-home", group: "site", path: "/", ...PHONE },
  { name: "site-blog-post", group: "site", path: "/blog/welcome", ...PHONE },
  { name: "site-docs", group: "site", path: "/docs", ...PHONE },
  { name: "site-themes", group: "site", path: "/themes", ...PHONE },
  { name: "admin-sign-in", group: "site", path: "/admin/sign-in", ...DESK },
  // The admin, signed in as an owner (a store copied from the template).
  { name: "admin-stores", group: "admin", path: "/admin", state: "owner", ...DESK },
  { name: "admin-home", group: "admin", path: "/admin/e2e-shop", state: "owner", ...DESK },
  { name: "admin-orders", group: "admin", path: "/admin/e2e-shop/orders", state: "owner", ...DESK },
  { name: "admin-products", group: "admin", path: "/admin/e2e-shop/products", state: "owner", ...DESK },
  { name: "admin-product-editor", group: "admin", path: `/admin/e2e-shop/products/${product}`, state: "owner", ...DESK },
  { name: "admin-customers", group: "admin", path: "/admin/e2e-shop/customers", state: "owner", ...DESK },
  { name: "admin-pages", group: "admin", path: "/admin/e2e-shop/pages", state: "owner", ...DESK },
  { name: "admin-page-builder", group: "admin", path: `/admin/e2e-shop/pages/${pageId}`, state: "owner", ...DESK },
  { name: "admin-media", group: "admin", path: "/admin/e2e-shop/media", state: "owner", ...DESK },
  { name: "admin-analytics", group: "admin", path: "/admin/e2e-shop/analytics", state: "owner", ...DESK },
  { name: "admin-discounts", group: "admin", path: "/admin/e2e-shop/discounts", state: "owner", ...DESK },
  { name: "admin-settings", group: "admin", path: "/admin/e2e-shop/settings", state: "owner", ...DESK },
  { name: "admin-settings-features", group: "admin", path: "/admin/e2e-shop/settings/features", state: "owner", ...DESK },
  { name: "admin-platform-home", group: "admin", path: "/admin/platform", state: "admin", ...DESK },
  { name: "admin-platform-stores", group: "admin", path: "/admin/platform/stores", state: "admin", ...DESK },
];
// The money path (step 1.7): a cart with two lines and its checkout at the payment step, in the shopper's own browser state.
if (args.moneyState && args.moneyCart && args.moneyCheckout) {
  PAGES.push(
    { name: "store-cart-two-lines", group: "storefront", path: args.moneyCart, stateFile: args.moneyState, ...PHONE },
    { name: "store-checkout-payment", group: "storefront", path: args.moneyCheckout, stateFile: args.moneyState, ...PHONE },
  );
} else {
  console.log("money path skipped: pass moneyState, moneyCart and moneyCheckout");
}

/** Bytes of a script that ran at least once, from V8's nested ranges (a later, inner range overrides the outer one). */
function usedBytes(entry) {
  const length = entry.source?.length ?? 0;
  if (!length) return { total: 0, used: 0 };
  const mark = new Uint8Array(length);
  const ranges = entry.functions.flatMap((fn) => fn.ranges).sort((a, b) => a.startOffset - b.startOffset || b.endOffset - a.endOffset);
  for (const range of ranges) mark.fill(range.count > 0 ? 1 : 0, range.startOffset, Math.min(range.endOffset, length));
  let used = 0;
  for (let i = 0; i < length; i++) used += mark[i];
  return { total: length, used };
}

const kindOf = (type, url) => {
  if (type === "Document") return "document";
  if (type === "Script") return "script";
  if (type === "Stylesheet") return "style";
  if (type === "Font") return "font";
  if (type === "Image") return "picture";
  if (type === "Fetch" || type === "XHR") return url.includes("_rsc=") ? "rsc" : "fetch";
  if (type === "Ping") return "beacon";
  return "other";
};

async function measure(browser, spec, slow = false) {
  const context = await browser.newContext({
    viewport: spec.viewport,
    isMobile: spec.isMobile,
    hasTouch: spec.hasTouch,
    deviceScaleFactor: spec.deviceScaleFactor,
    storageState: spec.stateFile ?? (spec.state ? join(REPO, `e2e/.auth/${spec.state}.json`) : undefined),
  });
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send("Network.enable");
  const requests = new Map();
  let loadedAt = null;
  cdp.on("Network.requestWillBeSent", (e) => {
    requests.set(e.requestId, { url: e.request.url, method: e.request.method, type: e.type, started: e.timestamp, afterLoad: loadedAt !== null, transfer: 0, decoded: 0, status: 0 });
  });
  cdp.on("Network.responseReceived", (e) => {
    const r = requests.get(e.requestId);
    if (r) { r.status = e.response.status; r.type = e.type; r.mime = e.response.mimeType; r.encoding = e.response.headers["content-encoding"] ?? e.response.headers["Content-Encoding"] ?? ""; r.cacheControl = e.response.headers["cache-control"] ?? e.response.headers["Cache-Control"] ?? ""; }
  });
  cdp.on("Network.dataReceived", (e) => { const r = requests.get(e.requestId); if (r) r.decoded += e.dataLength; });
  cdp.on("Network.loadingFinished", (e) => { const r = requests.get(e.requestId); if (r) r.transfer = e.encodedDataLength; });
  page.on("load", () => { loadedAt = Date.now(); });

  if (slow) {
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: SLOW_CPU });
    await page.addInitScript(() => {
      window.__long = [];
      window.__lcp = 0;
      try {
        new PerformanceObserver((list) => { for (const entry of list.getEntries()) window.__long.push(entry.duration); }).observe({ type: "longtask", buffered: true });
        new PerformanceObserver((list) => { for (const entry of list.getEntries()) window.__lcp = entry.startTime; }).observe({ type: "largest-contentful-paint", buffered: true });
      } catch {}
    });
  }
  await page.coverage.startJSCoverage({ resetOnNavigation: false });
  await page.coverage.startCSSCoverage({ resetOnNavigation: false });
  const response = await page.goto(BASE + spec.path, { waitUntil: "load", timeout: 60_000 });
  const html = await response.text();
  // Idle callbacks, lazy parts and beacons: wait for the network to settle, then three seconds more.
  await page.waitForLoadState("networkidle", { timeout: 30_000 }).catch(() => {});
  await page.waitForTimeout(3000);
  const js = await page.coverage.stopJSCoverage();
  const css = await page.coverage.stopCSSCoverage();

  const dom = await page.evaluate(() => {
    const all = document.querySelectorAll("*");
    let inlineStyle = 0, hidden = 0, dataAttrs = 0, classBytes = 0;
    for (const el of all) {
      const style = el.getAttribute("style");
      if (style) inlineStyle += style.length;
      const cls = el.getAttribute("class");
      if (cls) classBytes += cls.length;
      for (const a of el.attributes) if (a.name.startsWith("data-")) dataAttrs += a.name.length + a.value.length;
    }
    for (const el of document.body.querySelectorAll("*")) {
      if (el.tagName === "SCRIPT" || el.tagName === "STYLE" || el.tagName === "TEMPLATE") continue;
      const cs = getComputedStyle(el);
      if (cs.display === "none" && el.parentElement && getComputedStyle(el.parentElement).display !== "none") hidden += el.outerHTML.length;
    }
    const nav = performance.getEntriesByType("navigation")[0];
    const paints = Object.fromEntries(performance.getEntriesByType("paint").map((p) => [p.name, Math.round(p.startTime)]));
    return {
      elements: all.length,
      svgs: document.querySelectorAll("svg").length,
      svgBytes: [...document.querySelectorAll("svg")].reduce((n, s) => n + s.outerHTML.length, 0),
      images: document.images.length,
      scriptsWithSrc: document.querySelectorAll("script[src]").length,
      inlineStyleAttrBytes: inlineStyle,
      classAttrBytes: classBytes,
      dataAttrBytes: dataAttrs,
      hiddenMarkupBytes: hidden,
      styleBlockBytes: [...document.querySelectorAll("style")].reduce((n, s) => n + s.textContent.length, 0),
      ttfbMs: Math.round(nav.responseStart), domContentLoadedMs: Math.round(nav.domContentLoadedEventEnd), loadMs: Math.round(nav.loadEventEnd),
      firstContentfulPaintMs: paints["first-contentful-paint"] ?? null,
      title: document.title,
    };
  });
  const finalUrl = page.url();
  const timing = slow ? await page.evaluate(() => ({ long: window.__long ?? [], lcp: window.__lcp ?? 0 })) : null;
  await context.close();

  // The document as the server sent it.
  writeFileSync(join(out, "html", `${spec.name}.html`), html);
  const rscPushes = [...html.matchAll(/<script[^>]*>(self\.__next_f\.push\([\s\S]*?)<\/script>/g)].reduce((n, m) => n + m[1].length, 0);
  const inlineScripts = [...html.matchAll(/<script(?![^>]*\ssrc=)[^>]*>([\s\S]*?)<\/script>/g)].reduce((n, m) => n + m[1].length, 0);
  const styleBlocks = [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].reduce((n, m) => n + m[1].length, 0);
  const styleAttrs = [...html.matchAll(/\sstyle="([^"]*)"/g)].reduce((n, m) => n + m[1].length, 0);
  const jsonLd = [...html.matchAll(/<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/g)].reduce((n, m) => n + m[1].length, 0);
  const firstScriptUrls = [...new Set([...html.matchAll(/<script[^>]*\ssrc="([^"]+)"/g)].map((m) => m[1].replace(/&amp;/g, "&")))];
  const preloads = [...html.matchAll(/<link[^>]*rel="(?:preload|modulepreload)"[^>]*>/g)].length;

  const list = [...requests.values()].filter((r) => r.url.startsWith("http"));
  const byKind = {};
  for (const r of list) {
    const kind = kindOf(r.type, r.url);
    r.kind = kind;
    const k = (byKind[kind] ??= { requests: 0, transfer: 0, decoded: 0 });
    k.requests++; k.transfer += r.transfer; k.decoded += r.decoded;
  }
  const scripts = js.filter((e) => e.url.startsWith("http")).map((e) => ({ url: e.url.replace(BASE, ""), ...usedBytes(e) }));
  const scriptTotals = scripts.reduce((t, s) => ({ total: t.total + s.total, used: t.used + s.used }), { total: 0, used: 0 });
  const styles = css.map((e) => ({ url: (e.url || "inline").replace(BASE, ""), total: e.text.length, used: e.ranges.reduce((n, r) => n + (r.end - r.start), 0) }));
  const styleTotals = styles.reduce((t, s) => ({ total: t.total + s.total, used: t.used + s.used }), { total: 0, used: 0 });
  const firstScripts = list.filter((r) => r.kind === "script" && firstScriptUrls.some((u) => r.url.endsWith(u) || r.url.includes(u)));
  const afterLoad = list.filter((r) => r.afterLoad).map((r) => ({ kind: r.kind, method: r.method, url: r.url.replace(BASE, "").slice(0, 160), status: r.status, transfer: r.transfer, decoded: r.decoded }));

  const slowFigures = timing
    ? { cpu: SLOW_CPU, blockingMs: Math.round(timing.long.reduce((n, d) => n + Math.max(0, d - 50), 0)), lcpMs: Math.round(timing.lcp), runBytes: scriptTotals.used }
    : undefined;

  return {
    ...(slowFigures ? { slowRun: slowFigures } : {}),
    name: spec.name, group: spec.group, path: spec.path, finalUrl: finalUrl.replace(BASE, ""), status: response.status(), viewport: spec.viewport.width,
    document: {
      raw: html.length, gzip: gzipSync(html).length,
      rscPayload: rscPushes, otherInlineScript: inlineScripts - rscPushes - jsonLd, jsonLd, styleBlocks, styleAttrs,
      markup: html.length - inlineScripts - styleBlocks - styleAttrs,
      firstScriptTags: firstScriptUrls.length, preloadLinks: preloads,
    },
    dom,
    requests: { total: list.length, transfer: list.reduce((n, r) => n + r.transfer, 0), decoded: list.reduce((n, r) => n + r.decoded, 0), byKind },
    firstScripts: { count: firstScripts.length, transfer: firstScripts.reduce((n, r) => n + r.transfer, 0), decoded: firstScripts.reduce((n, r) => n + r.decoded, 0) },
    scriptCoverage: { files: scripts.length, total: scriptTotals.total, used: scriptTotals.used, unusedShare: scriptTotals.total ? 1 - scriptTotals.used / scriptTotals.total : 0 },
    styleCoverage: { files: styles.length, total: styleTotals.total, used: styleTotals.used, unusedShare: styleTotals.total ? 1 - styleTotals.used / styleTotals.total : 0 },
    afterLoad,
    scripts: scripts.sort((a, b) => b.total - a.total),
    styles,
    responses: list.map((r) => ({ kind: r.kind, url: r.url.replace(BASE, "").slice(0, 200), status: r.status, transfer: r.transfer, decoded: r.decoded, afterLoad: r.afterLoad, cacheControl: r.cacheControl })),
  };
}

const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH || undefined, args: ["--no-sandbox"] });
const results = [];
for (const spec of PAGES) {
  try {
    // Once to warm the server (its caches and the page's first render), then the measured load in a fresh browser context.
    await fetch(BASE + spec.path, { redirect: "manual" }).catch(() => {});
    if (spec.state) await measure(browser, spec).catch(() => {});
    const result = await measure(browser, spec);
    if (args.slow && SLOW.has(spec.name)) {
      // Again with the CPU slowed: only its blocking time, largest paint and the script run by idle are kept, as `slow`.
      const again = await measure(browser, spec, true);
      result.slow = again.slowRun;
      console.log(`${"".padEnd(26)} slow x${SLOW_CPU}: blocking ${again.slowRun.blockingMs} ms, largest paint ${again.slowRun.lcpMs} ms, script run ${again.slowRun.runBytes} bytes`);
    }
    results.push(result);
    console.log(`${spec.name.padEnd(26)} ${String(result.status).padEnd(4)} doc ${(result.document.raw / 1024).toFixed(0).padStart(5)} KB  transfer ${(result.requests.transfer / 1024).toFixed(0).padStart(5)} KB  scripts ${(result.scriptCoverage.total / 1024).toFixed(0).padStart(5)} KB raw, ${(result.scriptCoverage.unusedShare * 100).toFixed(0)}% unused  requests ${result.requests.total}`);
  } catch (error) {
    console.log(`${spec.name}: FAILED ${error.message.split("\n")[0]}`);
    results.push({ name: spec.name, group: spec.group, path: spec.path, failed: error.message.split("\n")[0] });
  }
}
await browser.close();
writeFileSync(join(out, "routes.json"), JSON.stringify(results, null, 1));
console.log("written", join(out, "routes.json"));
