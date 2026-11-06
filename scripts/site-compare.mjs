// Kaizena Flow's site, checked before and after it is served from its own store (D474, step 5 of docs/platform-parity-plan.md).
//
// Reads every address in the site's sitemap (`/sitemap-kaizen.xml`) and, for each, what search engines see: the status (redirects not
// followed), where a redirect goes, the canonical address, the language versions (hreflang), the title and the robots meta tag.
//
//   node scripts/site-compare.mjs https://kaizenaflow.com > before.json          # before switching
//   node scripts/site-compare.mjs https://kaizenaflow.com --against before.json   # after: every address of both lists, and what changed
//
// With --against, the addresses of the earlier run are checked too (the switch must keep every address that was in the sitemap), and the
// script exits 1 when any address answers differently in status, redirect, canonical or hreflang; titles that changed are listed, not
// failed. Reads only; sends nothing but GET requests, a few at a time.
import { readFile } from "node:fs/promises";

const [origin, ...rest] = process.argv.slice(2);
if (!origin || !/^https?:\/\//.test(origin)) {
  console.error("Usage: node scripts/site-compare.mjs <origin> [--against before.json]");
  process.exit(2);
}
const againstAt = rest.indexOf("--against");
const before = againstAt >= 0 ? JSON.parse(await readFile(rest[againstAt + 1], "utf8")) : null;
const base = origin.replace(/\/+$/, "");

/** The attributes of one tag, names in lower case. */
function attributes(tag) {
  const out = {};
  for (const match of tag.matchAll(/([a-zA-Z-:]+)\s*=\s*"([^"]*)"/g)) out[match[1].toLowerCase()] = match[2].replace(/&amp;/g, "&");
  return out;
}

/** A path and query of an address on the site, so two runs on different origins compare. */
const pathOf = (href) => {
  try {
    const url = new URL(href, base);
    return url.origin === new URL(base).origin ? `${url.pathname}${url.search}` : url.href;
  } catch {
    return href;
  }
};

async function sitemapPaths() {
  const response = await fetch(`${base}/sitemap-kaizen.xml`, { redirect: "manual" });
  if (!response.ok) throw new Error(`sitemap-kaizen.xml answered ${response.status}`);
  const xml = await response.text();
  return [...new Set([...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => pathOf(m[1].replace(/&amp;/g, "&"))))];
}

async function look(path) {
  const response = await fetch(`${base}${path}`, { redirect: "manual", headers: { "User-Agent": "KaizenaFlowSiteCompare/1.0" } });
  const row = { status: response.status, location: null, canonical: null, hreflang: {}, title: null, robots: null };
  if (response.status >= 300 && response.status < 400) {
    row.location = pathOf(response.headers.get("location") ?? "");
    return row;
  }
  const html = await response.text();
  for (const [tag] of html.matchAll(/<link\b[^>]*>/gi)) {
    const a = attributes(tag);
    if (a.rel === "canonical") row.canonical = pathOf(a.href);
    if (a.rel === "alternate" && a.hreflang) row.hreflang[a.hreflang] = pathOf(a.href);
  }
  row.hreflang = Object.fromEntries(Object.entries(row.hreflang).sort(([a], [b]) => a.localeCompare(b)));
  const title = /<title>([^<]*)<\/title>/i.exec(html);
  row.title = title ? title[1].replace(/&amp;/g, "&").replace(/&#x27;|&#39;/g, "'").trim() : null;
  for (const [tag] of html.matchAll(/<meta\b[^>]*>/gi)) {
    const a = attributes(tag);
    if (a.name === "robots") row.robots = a.content;
  }
  return row;
}

async function all(paths) {
  const out = {};
  const queue = [...paths];
  await Promise.all(
    Array.from({ length: 4 }, async () => {
      while (queue.length > 0) {
        const path = queue.shift();
        try {
          out[path] = await look(path);
        } catch (error) {
          out[path] = { status: 0, error: String(error) };
        }
      }
    }),
  );
  return Object.fromEntries(Object.entries(out).sort(([a], [b]) => a.localeCompare(b)));
}

const listed = await sitemapPaths();
const paths = [...new Set([...listed, ...(before ? Object.keys(before.pages) : [])])];
const pages = await all(paths);
const run = { origin: base, at: new Date().toISOString(), listed, pages };

if (!before) {
  console.log(JSON.stringify(run, null, 2));
  process.exit(0);
}

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const failures = [];
const titles = [];
for (const path of paths) {
  const was = before.pages[path];
  const now = pages[path];
  if (!was) {
    if (now.status !== 200) failures.push({ path, was: "not listed before", now });
    continue;
  }
  for (const key of ["status", "location", "canonical", "hreflang", "robots"]) {
    if (!same(was[key], now[key])) failures.push({ path, key, was: was[key], now: now[key] });
  }
  if (was.title !== now.title) titles.push({ path, was: was.title, now: now.title });
}
const dropped = before.listed.filter((path) => !listed.includes(path));
console.log(JSON.stringify({ checked: paths.length, failures, titles, droppedFromSitemap: dropped, newInSitemap: listed.filter((p) => !before.listed.includes(p)) }, null, 2));
process.exit(failures.length > 0 ? 1 : 0);
