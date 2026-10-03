/**
 * Calibration of the replicator's grid and carousel detection (D155, C3) on real public pages. Run by hand, never in CI:
 *
 *   PLAYWRIGHT_CHROMIUM_PATH=/opt/pw-browsers/chromium pnpm exec tsx scripts/replicate-calibrate.ts [--only slug,slug] [--dir DIR] [--offline]
 *
 * For each page of `SITES` it loads the page ONCE at computers' and phones' width (the replicator's own `openOriginal()`, autoplay watch
 * included), keeps the captures and photographs in DIR, and then, offline from those files, builds the page twice with `buildReplica()`:
 * with grids (as the replicator does) and with every grid group rebuilt as columns (`reverted`), the way the replicator did before D155.
 * `--offline` skips loading and reads DIR again, so the converter can be run again on the same captures without touching a site.
 *
 * It writes DIR/results.json and DIR/results.md: per page, cards found against slides/cards visible, items built, how many of the
 * item's fields were filled, groups kept as columns and why, clones left out, the carousel's settings and autoplay, the number of rows
 * and blocks with and without grids, and the word rule checked on the real page (every word of every item is a word the capture holds).
 * The diff score before and after is measured by `e2e/replicate-calibrate.spec.ts`, which renders both builds through the app. For that the pages'
 * pictures are kept once (`--pictures`: each picture a page loaded, fetched once with the page as referer, shrunk to PNG) and put under
 * `public/calibrate-tmp/` before the app starts (`--publish`; `--unpublish` takes them away again): a grid's items take only the site's own pictures,
 * and `next start` serves only the files that were in `public/` when it started. Nothing of this is part of the app.
 *
 * This script is the ONE deliberate exception to D150's rules that Chromium is launched only by `src/server/browser.ts` and that everything fetched from another
 * site goes through `safeFetch()`: it is a developer's tool that runs by hand on a developer's machine, outside the app and outside Vercel, and `src/server/*`
 * is `server-only` (it cannot be imported from here). It keeps their intent where it can: a picture's address passes `parseReplicaUrl()`, every address its host
 * resolves to passes `isBlockedAddress()` (a page cannot send this machine to its own network by naming a private picture), each redirect is checked the same
 * way, and a picture is read to at most `PICTURE_BYTES_MAX` bytes. What it cannot keep is "the connection is made to the address that was checked": `fetch` resolves
 * the name again (and in a sandbox a proxy resolves it, where the local lookup may find nothing: the host-name rules of `parseReplicaUrl()` still hold).
 */
import dns from "node:dns/promises";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { X509Certificate, createHash, randomUUID } from "node:crypto";

import { chromium } from "playwright-core";
import sharp from "sharp";

import type { CustomGridItem } from "../src/lib/page-content";
import { buildReplica, type BuildOutput } from "../src/lib/replicate-build";
import { walk, type PageCapture } from "../src/lib/replicate-capture";
import { tokensOf } from "../src/lib/replicate-grid";
import { pictureAddresses } from "../src/lib/replicate-assets-plan";
import { openOriginal } from "../src/lib/replicate-open";
import { isBlockedAddress, parseReplicaUrl } from "../src/lib/replicate-url";

export type Site = { slug: string; url: string; why: string };

/** Public marketing and documentation pages of well-known libraries and brands: card grids, blog and product card rows, testimonial sliders, logo strips, script sliders. */
export const SITES: Site[] = [
  { slug: "swiper", url: "https://swiperjs.com/", why: "Swiper's own site (Swiper sliders, feature cards)" },
  { slug: "slick", url: "https://kenwheeler.github.io/slick/", why: "Slick's demo page (Slick tracks with clones, hidden slides)" },
  { slug: "splide", url: "https://splidejs.com/", why: "Splide's own site (Splide lists)" },
  { slug: "embla", url: "https://www.embla-carousel.com/", why: "Embla's own site (Embla container)" },
  { slug: "glide", url: "https://glidejs.com/", why: "Glide.js' own site (Glide slides)" },
  { slug: "owl", url: "https://owlcarousel2.github.io/OwlCarousel2/", why: "Owl Carousel 2's site (owl-stage, cloned items)" },
  { slug: "flickity", url: "https://flickity.metafizzy.co/", why: "Flickity's site (flickity-slider)" },
  { slug: "keen", url: "https://keen-slider.io/", why: "Keen Slider's site" },
  { slug: "bootstrap", url: "https://getbootstrap.com/", why: "Bootstrap's front page (feature cards, icon rows)" },
  { slug: "tailwind", url: "https://tailwindcss.com/", why: "Tailwind CSS' front page (card grids, logo strip)" },
  { slug: "daisyui", url: "https://daisyui.com/", why: "daisyUI's front page (component cards)" },
  { slug: "smashing", url: "https://www.smashingmagazine.com/articles/", why: "A blog's article card list" },
  { slug: "vercel", url: "https://vercel.com/", why: "A brand's front page (logo strip, template cards, testimonials)" },
  { slug: "stripe", url: "https://stripe.com/", why: "A brand's front page (customer logos, product cards)" },
  { slug: "oda", url: "https://oda.com/no/", why: "A Nordic grocer's front page (product cards with prices in kr, sliders)" },
  { slug: "allbirds", url: "https://www.allbirds.com/", why: "A shop's front page (product cards with prices, a testimonial row)" },
  { slug: "webdev", url: "https://web.dev/blog", why: "A blog's article cards in a grid (picture, title, text, date)" },
  { slug: "freecodecamp", url: "https://www.freecodecamp.org/news/", why: "A blog's article cards" },
  { slug: "astro", url: "https://astro.build/", why: "A framework's front page (showcase cards, testimonials, logos)" },
  { slug: "svelte", url: "https://svelte.dev/", why: "A framework's front page (feature cards, a logo strip)" },
  { slug: "laravel", url: "https://laravel.com/", why: "A framework's front page (product cards, partner logos)" },
  { slug: "mozilla", url: "https://www.mozilla.org/en-US/", why: "A foundation's front page (story cards)" },
  { slug: "notion", url: "https://www.notion.com/", why: "A brand's front page (customer logos, testimonial cards)" },
  { slug: "shopify", url: "https://www.shopify.com/", why: "A brand's front page (feature cards, merchants' logos)" },
  { slug: "kde", url: "https://kde.org/", why: "A project's front page (feature cards, news cards)" },
  { slug: "python", url: "https://www.python.org/", why: "A language's front page (a tabbed box, news and event cards)" },
];

/**
 * Chromium must trust the sandbox proxy's CA to open https pages through it. Verification stays on: the browser is told to accept that one
 * CA's key (its public-key hash) and nothing else, never to ignore certificate errors.
 */
function proxyTrust(): string[] {
  const file = process.env.CALIBRATE_PROXY_CA ?? "/root/.ccr/agent-proxy-ca.crt";
  if (!process.env.HTTPS_PROXY || !fs.existsSync(file)) return [];
  const spki = new X509Certificate(fs.readFileSync(file)).publicKey.export({ type: "spki", format: "der" });
  return [`--ignore-certificate-errors-spki-list=${createHash("sha256").update(spki).digest("base64")}`];
}

const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? (args[i + 1] ?? "") : null;
};
const only = flag("--only")?.split(",").filter(Boolean) ?? null;
const dir = path.resolve(flag("--dir") ?? "test-results/calibrate");
const offline = args.includes("--offline");
const pictures = args.includes("--pictures");
const publish = args.includes("--publish");
const unpublish = args.includes("--unpublish");
const PUBLIC = path.resolve("public", "calibrate-tmp");

export type SiteResult = {
  slug: string;
  url: string;
  why: string;
  loaded: boolean;
  problem?: string;
  /** Seconds spent opening both widths, with the autoplay watch. */
  openSeconds?: number;
  nodes?: { desktop: number; mobile: number | null };
  /** The page's own slider tracks the extractor found, and sideways scrollers. */
  tracks?: { sliders: number; scrollers: number; hints: string[] };
  grids: {
    path: string;
    sel: string;
    y: number;
    slider: boolean;
    cards: number;
    items: number;
    cut: number;
    /** Fields filled, as a share of the fields an item can hold that the page had: pictures, titles, texts, links, buttons, badges, prices, dates, details. */
    fields: Record<string, number>;
    coverage: number;
    failedCards: number;
    carousel: null | { arrows: boolean; dots: boolean; snap: string; rewind: boolean; perScreen: { desktop: number; phone: number | null }; clones: number; autoplay: string; watchedMs: number | null };
    columns: unknown;
  }[];
  kept: { sel: string; y: number; cards: number; reason: string; slider: boolean }[];
  /** `drop()` entries of the grid kinds. */
  dropped: { kind: string; sel: string; y: number; text?: string }[];
  counts: { withGrids: { rows: number; blocks: number }; asColumns: { rows: number; blocks: number } } | null;
  /** The word rule on the real page: words in items that no node of the capture holds. */
  invented: string[];
  itemWords: number;
  notes: string[];
};

const FIELD_KEYS = ["pictures", "titles", "texts", "links", "buttons", "badges", "prices", "dates", "details"] as const;

/** Every word the capture holds anywhere (text runs, link and picture alt texts, slides' own text), as `tokensOf()` cuts them. */
export function captureWords(capture: PageCapture | null): Set<string> {
  const words = new Set<string>();
  if (!capture) return words;
  for (const node of walk(capture.root)) {
    // Runs are pieces of one text (`$` and `25` is `$25`): the words of the joined text, and of each piece.
    if (node.runs) for (const w of tokensOf(node.runs.map((run) => (run.br ? " " : run.t)).join(""))) words.add(w);
    for (const run of node.runs ?? []) for (const w of tokensOf(run.t)) words.add(w);
    if (node.media?.kind === "img") for (const w of tokensOf(node.media.alt)) words.add(w);
    if (node.media?.kind === "control") for (const w of tokensOf(node.media.label)) words.add(w);
    if (node.slide) for (const w of tokensOf(node.slide.text)) words.add(w);
  }
  return words;
}

type Pictures = (url: string) => { url: string; width: number; height: number } | null;

/** Pictures are not downloaded here: each is stood in for by a path on the site, at its measured size, so a card's picture is kept as the replicator keeps it. */
const standIn: Pictures = (url) => (/^https?:/i.test(url) ? { url: `/demo/${Math.abs([...url].reduce((h, c) => (h * 31 + c.charCodeAt(0)) | 0, 7))}.webp`, width: 800, height: 600 } : null);

export function build(desktop: PageCapture, mobile: PageCapture | null, reverted?: { path: string; match: number; pass: number }[]): BuildOutput {
  return buildReplica({ desktop, mobile, picture: standIn, shot: () => null, video: () => null, font: () => null, ...(reverted ? { reverted } : {}) }, randomUUID);
}

/** The items of every custom grid block of a build, in order. */
function itemsOf(built: BuildOutput): CustomGridItem[] {
  const out: CustomGridItem[] = [];
  const visit = (value: unknown) => {
    if (!value || typeof value !== "object") return;
    if (Array.isArray(value)) return value.forEach(visit);
    const o = value as Record<string, unknown>;
    if (o.type === "contentGrid" && Array.isArray(o.items)) out.push(...(o.items as CustomGridItem[]));
    for (const v of Object.values(o)) visit(v);
  };
  visit(built.rows);
  return out;
}

export function analyse(site: Site, desktop: PageCapture, mobile: PageCapture | null): SiteResult {
  const grid = build(desktop, mobile);
  const columns = build(desktop, mobile, grid.grids.built.map((g) => ({ path: g.path, match: 0, pass: 0 })));
  const words = captureWords(desktop);
  for (const w of captureWords(mobile)) words.add(w);
  const items = itemsOf(grid);
  const invented = new Set<string>();
  let itemWords = 0;
  for (const item of items) {
    const texts = [item.title, item.text, item.buttonLabel, item.badge, item.priceText, item.picture?.alt ?? "", ...item.details.flatMap((d) => [d.label, d.text])];
    for (const t of texts) for (const w of tokensOf(t)) {
      itemWords += 1;
      if (!words.has(w)) invented.add(w);
    }
  }
  const nodes = [...walk(desktop.root)];
  const hints = new Set<string>();
  for (const n of nodes) for (const h of n.slider?.hints ?? []) hints.add(h);
  return {
    slug: site.slug,
    url: site.url,
    why: site.why,
    loaded: true,
    nodes: { desktop: nodes.length, mobile: mobile ? [...walk(mobile.root)].length : null },
    tracks: { sliders: nodes.filter((n) => n.slider).length, scrollers: desktop.extras?.total.scrollers ?? 0, hints: [...hints].slice(0, 8) },
    grids: grid.grids.built.map((g) => {
      const filled = FIELD_KEYS.filter((k) => g.fields[k] > 0).length;
      return {
        path: g.path,
        sel: g.sel,
        y: g.y,
        slider: Boolean(g.carousel?.script),
        cards: g.cards,
        items: g.items,
        cut: g.cut,
        fields: g.fields,
        coverage: Math.round((filled / FIELD_KEYS.length) * 100),
        failedCards: g.failed.length,
        carousel: g.carousel
          ? { arrows: g.carousel.arrows, dots: g.carousel.dots, snap: g.carousel.snap, rewind: Boolean(g.carousel.rewind), perScreen: g.carousel.perScreen, clones: g.carousel.clones, autoplay: g.carousel.autoplay, watchedMs: g.carousel.watched?.ms ?? null }
          : null,
        columns: g.columns,
      };
    }),
    kept: grid.grids.kept.map((k) => ({ sel: k.sel, y: k.y, cards: k.cards, reason: k.reason, slider: Boolean(k.slider) })),
    dropped: grid.dropped.filter((d) => d.kind.startsWith("grid")).map((d) => ({ kind: d.kind, sel: d.sel, y: d.y, ...(d.text ? { text: d.text } : {}) })),
    counts: { withGrids: { rows: grid.counts.rows, blocks: grid.counts.blocks }, asColumns: { rows: columns.counts.rows, blocks: columns.counts.blocks } },
    invented: [...invented],
    itemWords,
    notes: grid.notes.map((n) => n.text).slice(0, 12),
  };
}

function markdown(results: SiteResult[]): string {
  const lines: string[] = ["# Grid and carousel calibration (D155, C3)", "", `Run ${new Date().toISOString()}. One load per page (computers' and phones' width), builds offline from the captures.`, ""];
  lines.push("| Page | Grids | Cards → items | Kept as columns | Blocks (grid / columns) | Invented words |", "|---|---|---|---|---|---|");
  for (const r of results) {
    if (!r.loaded) {
      lines.push(`| ${r.slug} | not loaded: ${r.problem} | | | | |`);
      continue;
    }
    lines.push(
      `| ${r.slug} | ${r.grids.length} | ${r.grids.map((g) => `${g.cards}→${g.items}`).join(", ") || "-"} | ${r.kept.length} | ${r.counts?.withGrids.blocks} / ${r.counts?.asColumns.blocks} | ${r.invented.length}/${r.itemWords} |`,
    );
  }
  for (const r of results.filter((x) => x.loaded)) {
    lines.push("", `## ${r.slug}`, "", `${r.url}: ${r.why}. ${r.nodes?.desktop} boxes at computers' width; ${r.tracks?.sliders} script track(s), ${r.tracks?.scrollers} sideways scroller(s)${r.tracks?.hints.length ? ` (${r.tracks.hints.join(", ")})` : ""}. ${r.openSeconds === undefined ? "" : `Opened in ${r.openSeconds} s.`}`, "");
    for (const g of r.grids) {
      const c = g.carousel;
      lines.push(
        `- GRID ${g.sel} (${g.y}px): ${g.cards} → ${g.items} items${g.cut ? `, ${g.cut} cut` : ""}; fields ${FIELD_KEYS.map((k) => `${k} ${g.fields[k]}`).join(", ")} (${g.coverage}% of kinds); failed cards ${g.failedCards}${c ? `; carousel arrows ${c.arrows}, dots ${c.dots}, snap ${c.snap}, rewind ${c.rewind}, ${c.perScreen.desktop}/${c.perScreen.phone ?? "-"} per screen, clones ${c.clones}, autoplay ${c.autoplay}${c.watchedMs !== null ? ` (watched ${Math.round(c.watchedMs / 100) / 10} s)` : ""}` : ""}`,
      );
    }
    for (const k of r.kept) lines.push(`- KEPT ${k.sel} (${k.y}px): ${k.cards} boxes: ${k.reason}`);
    if (r.invented.length) lines.push(`- INVENTED WORDS: ${r.invented.slice(0, 20).join(", ")}`);
  }
  return lines.join("\n") + "\n";
}

/** The most of a picture this tool reads: a page cannot make it hold more in memory. */
export const PICTURE_BYTES_MAX = 8 * 1024 * 1024;
const REDIRECTS_MAX = 3;

/** Whether a picture's address may be fetched from this machine: a public web address, whose host does not resolve to a private, loopback or link-local address. */
export async function pictureAddressOk(raw: string): Promise<boolean> {
  const parsed = parseReplicaUrl(raw);
  if (!parsed.ok) return false;
  const host = parsed.url.hostname.replace(/^\[|\]$/g, "");
  if (net.isIP(host)) return !isBlockedAddress(host);
  try {
    const found = await dns.lookup(host, { all: true });
    return found.length > 0 && !found.some((a) => isBlockedAddress(a.address));
  } catch {
    // Not resolvable here: in a sandbox the proxy resolves names. The host-name rules of `parseReplicaUrl()` have held; nothing more can be checked.
    return Boolean(process.env.HTTPS_PROXY);
  }
}

/** One picture's bytes, from a checked address through checked redirects, read to at most `PICTURE_BYTES_MAX`; null when it may not be fetched or is too large. */
export async function fetchPicture(url: string, referer: string): Promise<Buffer | null> {
  let at = url;
  for (let hop = 0; hop <= REDIRECTS_MAX; hop++) {
    if (!(await pictureAddressOk(at))) return null;
    const response = await fetch(at, { headers: { "User-Agent": "Mozilla/5.0", Referer: referer }, redirect: "manual", signal: AbortSignal.timeout(20_000) });
    if (response.status >= 300 && response.status < 400) {
      const next = response.headers.get("location");
      if (!next) return null;
      at = new URL(next, at).toString();
      continue;
    }
    if (!response.ok || !response.body) return null;
    const chunks: Uint8Array[] = [];
    let size = 0;
    const reader = response.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > PICTURE_BYTES_MAX) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
    return Buffer.concat(chunks);
  }
  return null;
}

/** Keeps each picture of a page once, as PNG at most 1600 px wide: `pictures/{n}.png` and `pictures.json` (address → file and size). */
async function keepPictures(base: string, desktop: PageCapture, mobile: PageCapture | null): Promise<number> {
  const out = path.join(base, "pictures");
  fs.mkdirSync(out, { recursive: true });
  const found: Record<string, { file: string; width: number; height: number }> = {};
  const wanted = pictureAddresses([desktop, mobile]).urls;
  let n = 0;
  const queue = [...wanted];
  const worker = async () => {
    for (let url = queue.shift(); url !== undefined; url = queue.shift()) {
      try {
        const bytes = await fetchPicture(url, desktop.url);
        if (!bytes) continue;
        const png = await sharp(bytes, { density: 144 }).resize({ width: 1600, withoutEnlargement: true }).png().toBuffer({ resolveWithObject: true });
        const file = `${++n}.png`;
        fs.writeFileSync(path.join(out, file), png.data);
        found[url] = { file, width: png.info.width, height: png.info.height };
      } catch {
        /* a picture that cannot be fetched or read is left out, as the replicator leaves it out */
      }
    }
  };
  await Promise.all(Array.from({ length: 6 }, worker));
  fs.writeFileSync(path.join(base, "pictures.json"), JSON.stringify(found));
  return Object.keys(found).length;
}

async function main() {
  if (unpublish) {
    fs.rmSync(PUBLIC, { recursive: true, force: true });
    console.log(`removed ${PUBLIC}`);
    return;
  }
  if (publish) {
    fs.rmSync(PUBLIC, { recursive: true, force: true });
    for (const name of fs.readdirSync(dir)) {
      const from = path.join(dir, name, "pictures");
      if (fs.existsSync(from)) fs.cpSync(from, path.join(PUBLIC, name), { recursive: true });
    }
    console.log(`published to ${PUBLIC}`);
    return;
  }
  fs.mkdirSync(dir, { recursive: true });
  const sites = SITES.filter((s) => !only || only.includes(s.slug));
  const results: SiteResult[] = [];
  const browser = offline
    ? null
    : await chromium.launch({ ...(process.env.PLAYWRIGHT_CHROMIUM_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH } : {}), ...(process.env.HTTPS_PROXY ? { proxy: { server: process.env.HTTPS_PROXY, bypass: "localhost,127.0.0.1" }, args: proxyTrust() } : {}) });
  // tsx compiles with esbuild's keepNames, which wraps functions in `__name(...)`; the extractor runs inside the page, where there is no such helper.
  if (browser) {
    const open = browser.newContext.bind(browser);
    browser.newContext = (async (...a: Parameters<typeof open>) => {
      const context = await open(...a);
      await context.addInitScript("window.__name = (f) => f;");
      return context;
    }) as typeof browser.newContext;
  }
  try {
    for (const site of sites) {
      const base = path.join(dir, site.slug);
      fs.mkdirSync(base, { recursive: true });
      const files = { d: path.join(base, "capture-desktop.json"), m: path.join(base, "capture-mobile.json") };
      let openSeconds: number | undefined;
      try {
        if (!offline) {
          const started = Date.now();
          const everything = async () => true;
          const desktop = await openOriginal(browser!, site.url, "desktop", everything);
          fs.writeFileSync(files.d, JSON.stringify(desktop.capture));
          fs.writeFileSync(path.join(base, "original-desktop.png"), desktop.screenshot);
          try {
            const mobile = await openOriginal(browser!, site.url, "mobile", everything, undefined, { watch: false });
            fs.writeFileSync(files.m, JSON.stringify(mobile.capture));
            fs.writeFileSync(path.join(base, "original-mobile.png"), mobile.screenshot);
          } catch (error) {
            fs.rmSync(files.m, { force: true });
            console.log(`[${site.slug}] phone width failed: ${error instanceof Error ? error.message : error}`);
          }
          openSeconds = Math.round((Date.now() - started) / 100) / 10;
        }
        const desktop = JSON.parse(fs.readFileSync(files.d, "utf8")) as PageCapture;
        const mobile = fs.existsSync(files.m) ? (JSON.parse(fs.readFileSync(files.m, "utf8")) as PageCapture) : null;
        if (pictures) console.log(`[${site.slug}] ${await keepPictures(base, desktop, mobile)} pictures kept`);
        const result = analyse(site, desktop, mobile);
        result.openSeconds = openSeconds;
        results.push(result);
        console.log(`[${site.slug}] ${result.grids.length} grid(s) (${result.grids.map((g) => `${g.cards}→${g.items}`).join(", ")}), ${result.kept.length} kept, invented ${result.invented.length}`);
      } catch (error) {
        const problem = error instanceof Error ? error.message : String(error);
        console.log(`[${site.slug}] NOT LOADED: ${problem}`);
        results.push({ slug: site.slug, url: site.url, why: site.why, loaded: false, problem, grids: [], kept: [], dropped: [], counts: null, invented: [], itemWords: 0, notes: [] });
      }
    }
  } finally {
    await browser?.close();
  }
  fs.writeFileSync(path.join(dir, "results.json"), JSON.stringify(results, null, 1));
  fs.writeFileSync(path.join(dir, "results.md"), markdown(results));
  console.log(`written to ${dir}/results.md`);
}

if (process.argv[1] && /replicate-calibrate\.ts$/.test(process.argv[1])) void main();
