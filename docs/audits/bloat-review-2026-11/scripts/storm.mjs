// Watches one page for repeated requests: node storm.mjs <url> [seconds] [phone|desk]
import { createRequire } from "node:module";
const require = createRequire(process.cwd() + "/");
const { chromium } = require("playwright-core");
const url = process.argv[2], seconds = Number(process.argv[3] ?? 12), form = process.argv[4] ?? "phone";
const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH || undefined, args: ["--no-sandbox"] });
const context = await browser.newContext(form === "phone" ? { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 } : { viewport: { width: 1440, height: 900 } });
const page = await context.newPage();
const cdp = await context.newCDPSession(page);
await cdp.send("Network.enable");
const seen = [];
const start = Date.now();
cdp.on("Network.requestWillBeSent", (e) => {
  seen.push({ t: Date.now() - start, url: e.request.url.replace(/^https?:\/\/[^/]+/, ""), type: e.type, method: e.request.method, headers: e.request.headers, initiator: e.initiator?.type, stack: (e.initiator?.stack?.callFrames ?? []).slice(0, 6).map((f) => `${f.functionName || "?"}@${f.url.split("/").pop()}:${f.lineNumber}:${f.columnNumber}`) });
});
const served = new Map();
cdp.on("Network.responseReceived", (e) => served.set(e.requestId, { fromDisk: e.response.fromDiskCache, fromPrefetch: e.response.fromPrefetchCache, status: e.response.status }));
page.on("console", (m) => { if (m.type() === "error") console.log("console error:", m.text().slice(0, 200)); });
await page.goto(url, { waitUntil: "load" });
await page.waitForTimeout(seconds * 1000);
const counts = {};
for (const r of seen) { const k = `${r.type} ${r.method} ${r.url.replace(/_rsc=[^&]+/, "_rsc=…").slice(0, 110)}`; counts[k] = (counts[k] ?? 0) + 1; }
const top = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 10);
console.log(`requests in ${seconds}s after load: ${seen.length}`);
for (const [k, n] of top) console.log(String(n).padStart(6), k);
const repeated = top[0] && top[0][1] > 20 ? seen.filter((r) => `${r.type} ${r.method} ${r.url.replace(/_rsc=[^&]+/, "_rsc=…").slice(0, 110)}` === top[0][0]) : [];
if (repeated.length) {
  console.log("first times (ms):", repeated.slice(0, 12).map((r) => r.t).join(", "));
  console.log("headers of one:", JSON.stringify(Object.fromEntries(Object.entries(repeated[5].headers).filter(([k]) => /next|rsc|purpose|sec-purpose|accept/i.test(k)))));
  console.log("initiator:", repeated[5].initiator, repeated[5].stack);
  console.log("served:", JSON.stringify([...served.values()].slice(-3)));
}
await browser.close();
