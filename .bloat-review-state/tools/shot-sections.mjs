// Screenshots each section of the wrapped page: node shot-sections.mjs <wrapped.html> <outPrefix> [width] [light|dark] [indexes,comma]
import { createRequire } from "node:module";
const require = createRequire("/home/user/kaizen-store/");
const { chromium } = require("playwright-core");
const [file, out, width = "1200", theme = "light", which = "", scale = "1"] = process.argv.slice(2);
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium", args: ["--no-sandbox"] });
const page = await browser.newPage({ viewport: { width: Number(width), height: 900 }, deviceScaleFactor: Number(scale), colorScheme: theme });
await page.goto("file://" + file);
if (theme === "dark") await page.evaluate(() => document.documentElement.setAttribute("data-theme", "dark"));
await page.waitForTimeout(900);
const els = await page.locator("header.top, section, footer").all();
const want = which ? which.split(",").map(Number) : els.map((_, i) => i);
for (const i of want) {
  if (els[i]) await els[i].screenshot({ path: out + "-" + i + ".png" });
}
console.log("sections:", els.length);
await browser.close();
