import { writeFileSync, readFileSync, existsSync } from "node:fs";

import { expect, test, type Page } from "@playwright/test";

import { testDb, testStore } from "./db";

/**
 * Responsive editing, phase 1 (D179, `docs/responsive-editing.md` 3 and 7): pages saved before the per-size model (the phone
 * switches `reverseOnMobile`, `sideBySide`, `stackOnPhones`, `hideOnPhones`, `carouselOn`, columns and alignments by screen)
 * must look as they did once their settings are upgraded on read and drawn from the part stylesheet instead of inline styles
 * and fixed Tailwind breakpoints. Each page is drawn at 375, 800, 1100 and 1400 px and the computed styles of every element
 * in the body are compared:
 *
 * - always: a store holding the old shapes against a store holding the same pages upgraded (`upgradeResponsive()`), in
 *   this build;
 * - with `PARITY_CAPTURE=file`: the old-shape store's styles are written to the file (run on a build of the commit before);
 * - with `PARITY_BASELINE=file`: the old-shape store's styles are compared with that file (the build after).
 *
 * Differences are allowed only where they are equal by construction, and normalised here: `text-align: start` is `left`
 * (every page is left to right); `flex-direction`, `justify-content` and `grid-template-columns` are compared only where
 * they act (a flex box, a grid).
 */

const WIDTHS = [375, 800, 1100, 1400] as const;

type Json = Record<string, unknown>;

const row = (id: string, layout: string, columns: Json[], extra: Json = {}): Json => ({ id, type: "row", layout, columns, ...extra });
const col = (id: string, blocks: Json[], extra: Json = {}): Json => ({ id, blocks, ...extra });
const doc = (text: string) => ({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] });
const text = (id: string, words: string, extra: Json = {}): Json => ({ id, type: "richText", doc: doc(words), ...extra });
const page = (title: string, slug: string, rows: Json[]): Json => ({
  title,
  slug,
  thumbnail: null,
  seo: { title: "", description: "" },
  searchEngines: true,
  aiAssistants: true,
  categories: [],
  tags: [],
  rows,
});
const item = (id: string, title: string) => ({ id, title, text: `${title} er en flis med litt tekst under.`, picture: null, link: null, buttonLabel: "", date: null, badge: "", priceText: "", details: [] });
const grid = (id: string, extra: Json): Json => ({
  id,
  type: "contentGrid",
  source: { type: "custom" },
  categories: [],
  tags: [],
  sort: "newest",
  limit: 6,
  columns: { mobile: 1, tablet: 2, desktop: 4 },
  show: { image: true, heading: true, excerpt: true, price: false, button: false },
  buttonLabel: "",
  emptyText: "",
  headingLevel: 3,
  excerptLines: 2,
  gap: 16,
  items: ["a", "b", "c", "d", "e"].map((x) => item(`${id}-${x}`, `Flis ${x.toUpperCase()}`)),
  ...extra,
});
/** A picture the app itself serves, so nothing waits on the network. */
const picture = { url: `http://localhost:${process.env.PORT ?? 3000}/demo/mug.svg`, width: 640, height: 480, alt: "Et bilde" };

/** Every old switch, in the places a page has them. */
function flatPage(): Json {
  return page("Flate", "flate", [
    row("r1", "2", [
      col("r1c1", [
        { id: "r1h", type: "heading", text: "Overskrift", level: 1, align: { tablet: "center" } },
        text("r1t", "Midtstilt på telefon, høyre på datamaskin.", { align: { mobile: "center", desktop: "right" } }),
        { id: "r1b", type: "button", label: "Knapp", href: "/", align: { mobile: "center" } },
      ]),
      col("r1c2", [
        { id: "r1i", type: "image", image: null, caption: "", maxWidth: 200, align: { mobile: "center", tablet: "right", desktop: "left" } },
        text("r1t2", "Venstre som standard, sentrert fra nettbrett.", { align: { tablet: "center" } }),
      ]),
    ], { reverseOnMobile: true, align: "middle" }),
    row("r2", "left-sidebar", [
      col("r2c1", [text("r2t", "Sidekolonne.")], { background: { type: "color", color: "#f1e8da" }, style: { padding: { top: 12, right: 12, bottom: 12, left: 12 } } }),
      col("r2c2", [text("r2t2", "Hovedkolonne side om side også på telefon.", { align: { mobile: "right", tablet: "left" } })]),
    ], {
      sideBySide: true,
      align: "bottom",
      style: { padding: { top: 32, right: 24, bottom: 32, left: 24 }, margin: { top: 8, right: 0, bottom: 8, left: 0 } },
      border: { width: { top: 2, right: 2, bottom: 2, left: 2 }, color: "#a84a26", style: "dashed" },
      radius: 12,
      shadow: "md",
      background: { type: "color", color: "#ffffff", opacity: 80 },
      backdropBlur: 4,
    }),
    row("r3", "3", [
      col("r3c1", [text("r3t1", "En.")], { border: { width: { top: 1, right: 1, bottom: 1, left: 1 }, color: "#e5e5e5", style: "solid" }, radius: 8 }),
      col("r3c2", [text("r3t2", "To, litt lengre tekst som går over flere linjer på smale skjermer.")]),
      col("r3c3", [
        { id: "r3b1", type: "button", label: "Én", href: "/" },
        { id: "r3b2", type: "button", label: "To", href: "/", variant: "outline" },
      ], { inline: true, justify: "between" }),
    ], { equalHeight: true, align: "middle" }),
    row("r4", "1", [col("r4c1", [grid("r4g1", {}), grid("r4g2", { columns: { mobile: 2, tablet: 3, desktop: 5 }, gap: 24 })])]),
    row("r5", "1", [col("r5c1", [grid("r5g", { display: "carousel", carouselOn: "phones", peek: true, columns: { mobile: 1, tablet: 2, desktop: 3 } })])]),
    row("r6", "2", [
      col("r6c1", [
        {
          id: "r6d",
          type: "dualButton",
          first: { label: "Handle nå", href: "/" },
          second: { label: "Les mer", href: "/", variant: "outline" },
          stackOnPhones: true,
          align: { mobile: "center", tablet: "left" },
        },
        { id: "r6s", type: "separator", width: 50, position: "center" },
      ]),
      col("r6c2", [
        { id: "r6i", type: "image", image: picture, caption: "Bildetekst", maxWidth: 240, align: { mobile: "right", desktop: "center" }, style: { margin: { top: 0, right: 0, bottom: 0, left: 16 } } },
        { id: "r6i2", type: "image", image: picture, caption: "", shape: "square", align: { tablet: "center" }, radius: 16, shadow: "sm" },
      ]),
    ], { width: "full", contentWidth: "content", background: { type: "color", color: "#f5f5f4" } }),
    row("r7", "fit-sides", [
      col("r7c1", [text("r7t1", "Venstre")]),
      col("r7c2", [text("r7t2", "Midten fyller", { align: { mobile: "center" } })]),
      col("r7c3", [text("r7t3", "Høyre")]),
    ], { width: "full", contentWidth: "full", reverseOnMobile: true }),
    row("r8", "1", [
      col("r8c1", [
        { id: "r8q", type: "testimonials", columns: 4, items: quotes("r8q") },
        { id: "r8k", type: "testimonials", columns: 3, display: "carousel", items: quotes("r8k") },
      ]),
    ]),
  ]);
}

/** Testimonials (D91), whose columns follow the screen sizes. */
const quotes = (id: string) =>
  ["a", "b", "c", "d", "e"].map((x) => ({ id: `${id}-${x}`, quote: `Sitat ${x}: en god opplevelse fra start til slutt.`, name: `Navn ${x}`, role: "Oslo", rating: 5, picture: null }));

function headerPage(menuId: string | null): Json {
  const menu = menuId ? [{ id: "hm", type: "menu", menuId, hideOnPhones: true }] : [];
  return page("Topp", "topp", [
    row("hr", "fit-sides", [
      col("hc1", [{ id: "hl", type: "site", part: "logo" }]),
      col("hc2", menu),
      col("hc3", [
        { id: "ha", type: "site", part: "account", hideOnPhones: true },
        { id: "hk", type: "site", part: "cart" },
        { id: "hb", type: "site", part: "menuButton" },
      ], { inline: true, justify: "end" }),
    ], { sideBySide: true, align: "middle" }),
  ]);
}

function footerPage(menuId: string | null): Json {
  const menu = menuId ? [{ id: "fm", type: "menu", menuId, direction: "column", align: { mobile: "center", tablet: "left" } }] : [];
  return page("Bunn", "bunn", [
    row("fr", "3", [
      col("fc1", [{ id: "fb", type: "site", part: "business", align: { mobile: "center", desktop: "left" } }]),
      col("fc2", menu),
      col("fc3", [{ id: "fk", type: "site", part: "cookies" }, { id: "fw", type: "site", part: "withdrawal", hideOnPhones: true }]),
    ]),
  ]);
}

function productLayout(): Json {
  return page("Produktside", "produktside", [
    row("pr1", "2", [
      col("pc1", [{ id: "pg", type: "product", part: "gallery" }]),
      col("pc2", [
        { id: "pt", type: "product", part: "title", align: { tablet: "center", desktop: "left" } },
        { id: "pp", type: "product", part: "price" },
        { id: "pb", type: "product", part: "buy" },
        { id: "pd", type: "product", part: "description" },
      ]),
    ], { reverseOnMobile: true }),
    row("pr2", "1", [col("pc3", [{ id: "prel", type: "product", part: "related", columns: { mobile: 1, tablet: 2, desktop: 3 } }])]),
  ]);
}

/** A store with these pages: `flate`, a header, a footer and a product layout, stored as given (`shape` turns old into new). */
async function storeWithPages(name: string, shape: (rows: Json[]) => Json[], keep?: string[]): Promise<{ slug: string; product: string; products: string[] }> {
  const { slug, id } = await testStore(name);
  const sql = testDb();
  try {
    const [menu] = await sql`select id from commerce.menus where store_id = ${id} order by name limit 1`;
    // The catalogue the build before was captured with: products other tests added to the template since are put aside.
    if (keep) await sql`update commerce.products set status = 'draft' where store_id = ${id} and status = 'active' and not (handle = any(${keep}))`;
    const active = await sql`select handle from commerce.products where store_id = ${id} and status = 'active' order by created_at, handle`;
    const product = active[0];
    const insert = async (type: string, content: Json) => {
      const shaped = { ...content, rows: shape(content.rows as Json[]) } as never;
      const [made] = await sql`
        insert into commerce.pages (store_id, type, slug, draft, published, published_at)
        values (${id}, ${type}, ${content.slug as string}, ${sql.json(shaped)}, ${sql.json(shaped)}, now()) returning id`;
      return made.id as string;
    };
    await insert("page", flatPage());
    const header = await insert("header", headerPage(menu?.id ?? null));
    const footer = await insert("footer", footerPage(menu?.id ?? null));
    const layout = await insert("product_layout", productLayout());
    await sql`update commerce.stores set header_id = ${header}, footer_id = ${footer}, product_layout_id = ${layout} where id = ${id}`;
    return { slug, product: product.handle as string, products: active.map((p) => p.handle as string) };
  } finally {
    await sql.end();
  }
}

type Styles = Record<string, Record<string, string>>;
type Capture = Record<string, Styles>;

const PROPS = [
  "display", "position", "visibility",
  "padding-top", "padding-right", "padding-bottom", "padding-left",
  "margin-top", "margin-right", "margin-bottom", "margin-left",
  "border-top-width", "border-right-width", "border-bottom-width", "border-left-width", "border-top-style", "border-top-color",
  "border-top-left-radius", "box-shadow", "background-color", "backdrop-filter",
  "text-align", "flex-direction", "flex-wrap", "order", "grid-template-columns", "align-items", "justify-content", "row-gap", "column-gap", "max-width",
];

/** Every element in the body by its place (tag and position among its siblings), with its box and its computed styles. */
async function styles(page: Page): Promise<Styles> {
  return page.evaluate((props) => {
    const out: Record<string, Record<string, string>> = {};
    const round = (n: number) => String(Math.round(n * 2) / 2);
    const walk = (el: Element, path: string) => {
      const tag = el.tagName.toLowerCase();
      if (["script", "style", "link", "meta", "noscript", "template", "next-route-announcer"].includes(tag)) return;
      const css = getComputedStyle(el);
      const box = el.getBoundingClientRect();
      const entry: Record<string, string> = { x: round(box.left), y: round(box.top + window.scrollY), w: round(box.width), h: round(box.height) };
      for (const prop of props) entry[prop] = css.getPropertyValue(prop);
      out[path] = entry;
      if (css.display === "none") return;
      let index = 0;
      for (const child of Array.from(el.children)) walk(child, `${path}>${child.tagName.toLowerCase()}:${index++}`);
    };
    walk(document.body, "body");
    return out;
  }, PROPS);
}

/** The page at each width, settled: its streamed parts in, its fonts loaded. */
async function captureAll(page: Page, paths: Record<string, string>): Promise<Capture> {
  const result: Capture = {};
  for (const [name, path] of Object.entries(paths)) {
    for (const width of WIDTHS) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(path);
      await page.waitForLoadState("load");
      // Streamed parts (stock, the buy box) are in once React has no hidden boundary left to swap in.
      await page.waitForFunction(() => !document.querySelector('[hidden][id^="S:"], template[id^="B:"]'), undefined, { timeout: 15_000 }).catch(() => {});
      await page.evaluate(() => document.fonts.ready);
      await page.waitForTimeout(800);
      result[`${name}@${width}`] = await styles(page);
    }
  }
  return result;
}

/** What differs, after the normalising said above; at most `limit` lines. */
export function differences(before: Capture, after: Capture, limit = 60): string[] {
  const out: string[] = [];
  const norm = (entry: Record<string, string>, prop: string): string | null => {
    const value = entry[prop];
    const display = entry.display ?? "";
    if (prop === "text-align") return value === "start" ? "left" : value;
    if ((prop === "flex-direction" || prop === "flex-wrap") && !display.includes("flex")) return null;
    if (prop === "grid-template-columns" && !display.includes("grid")) return null;
    if (prop === "justify-content" && !display.includes("flex")) return null;
    if ((prop === "row-gap" || prop === "column-gap" || prop === "align-items") && !display.includes("flex") && !display.includes("grid")) return null;
    return value;
  };
  for (const key of Object.keys(before)) {
    const a = before[key];
    const b = after[key];
    if (!b) {
      out.push(`${key}: missing`);
      continue;
    }
    for (const path of Object.keys(a)) {
      if (!b[path]) {
        out.push(`${key} ${path}: element missing`);
        continue;
      }
      for (const prop of Object.keys(a[path])) {
        const x = norm(a[path], prop);
        const y = norm(b[path], prop);
        if (x !== y) out.push(`${key} ${path} ${prop}: ${x} → ${y}`);
      }
    }
    for (const path of Object.keys(b)) if (!a[path]) out.push(`${key} ${path}: element added`);
  }
  return out.length > limit ? [...out.slice(0, limit), `… and ${out.length - limit} more`] : out;
}

const pathsOf = (store: { slug: string; product: string }) => ({
  front: `/s/${store.slug}/no`,
  flate: `/s/${store.slug}/no/flate`,
  about: `/s/${store.slug}/no/om-oss`,
  product: `/s/${store.slug}/no/p/${store.product}`,
});

test.describe.configure({ mode: "serial" });
test.setTimeout(300_000);

test("old pages look as they did before the per-size model (against a capture of the build before)", async ({ page }) => {
  const capture = process.env.PARITY_CAPTURE;
  const baseline = process.env.PARITY_BASELINE;
  test.skip(!capture && !(baseline && existsSync(baseline)), "Needs PARITY_CAPTURE or PARITY_BASELINE (a capture of the build before).");
  // A capture keeps the store's products, so a later run on a database other tests have added to compares the same catalogue.
  const saved = capture ? null : (JSON.parse(readFileSync(baseline!, "utf8")) as { products: string[]; styles: Capture });
  const store = await storeWithPages("parity-old", (rows) => rows, saved?.products);
  const now = await captureAll(page, { ...pathsOf(store), kaizen: "/" });
  if (capture) {
    writeFileSync(capture, JSON.stringify({ products: store.products, styles: now }));
    return;
  }
  const before = saved!.styles;
  const elements = Object.values(now).reduce((n, s) => n + Object.keys(s).length, 0);
  console.log(`parity against the build before: ${Object.keys(now).length} page widths, ${elements} elements, ${elements * PROPS.length} styles`);
  expect(differences(before, now)).toEqual([]);
});

test("a page stored in the old shape and the same page upgraded look the same", async ({ page }) => {
  test.skip(Boolean(process.env.PARITY_CAPTURE), "Capturing the build before.");
  const { upgradeResponsive } = await import("../src/lib/responsive");
  const old = await storeWithPages("parity-a", (rows) => rows);
  const upgraded = await storeWithPages("parity-b", (rows) => upgradeResponsive(rows) as Json[]);
  const a = await captureAll(page, pathsOf(old));
  const b = await captureAll(page, pathsOf(upgraded));
  expect(differences(a, b)).toEqual([]);
});
