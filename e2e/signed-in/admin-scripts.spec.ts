import { expect, test, type Browser, type Page, type Response } from "@playwright/test";

import { testDb } from "../db";

import { ADMIN, ADMIN_NB, E2E_STORE, E2E_STORE_NB, OWNER, OWNER_NB } from "./accounts";
import baseline from "./admin-handed.baseline.json";

/**
 * The admin's first scripts (PSI PERF-01's follow-up, `docs/performance.md` *The admin as people use it*): the screens people use most,
 * signed in, each under its own budget, raw (before compression) as `e2e/performance.spec.ts` holds the visitor's routes. The editors
 * and settings were the slow screens of the field's p75. A change that passes one is a regression to look at, not a number to raise.
 */
test.use({ storageState: OWNER.state });

/**
 * The scripts the screen's HTML asks for, as the server sends it (signed in), each fetched with its text: never what the page has loaded
 * by the time it is looked at, which grows with what it does after.
 */
async function firstScripts(page: Page, address: string): Promise<number> {
  const html = await (await page.request.get(address)).text();
  const urls = [...new Set([...html.matchAll(/<script[^>]*\ssrc="([^"]+)"/g)].map((match) => new URL(match[1].replace(/&amp;/g, "&"), page.url()).href))];
  const sizes = await Promise.all(urls.map(async (url) => (await (await page.request.get(url)).text()).length));
  return sizes.reduce((sum, size) => sum + size, 0);
}

const MEASURE = process.env.E2E_MEASURE === "1";

/**
 * Each screen's budget, by its address under the store (`{page}` is one of the store's pages). Measured on the build of 4 November 2026
 * from the HTML the server sends: home 2.37 MB, products 2.36, a new product 3.27, orders 2.37, pages 3.16, a page in the builder 4.39,
 * settings 2.34. About 4 % of room. On 31 October they were 3.02, 3.02, 3.71, 3.02, 3.59 (4.71 before the page lists stopped importing
 * the builder), 4.70 and 3.00; by 4 November each had grown about 0.1 MB, and the docs guide's entry in the admin map took the builder
 * over (4,901,307 bytes, D444). The AI manager's chat, and the admin map it names the page from, is now fetched when its panel is first
 * opened, not with every screen (`ai-manager-launcher.tsx`): 0.51 to 0.76 MB off each. On 10 November the admin's English, every area's,
 * left the first scripts (`admin-text-later.ts`): about 1.1 MB off each.
 */
const BUDGETS: Record<string, number> = {
  // Measured 14 November 2026 once the page builder and the rich text editor left the screens that do not edit a page (bloat review step
  // 0.10): a new product 1,197,589, pages 754,535, a page's preview 971,898, content 715,153 bytes; about 4 % of room, rounded up to 10,000.
  // The order page has no entry: e2e-shop has no order of its own (`markers.mjs` holds it). Lowered, never raised.
  // Measured 13 November 2026 once sign-in's English, the Supabase client and zod left the frame (bloat review step 0.9): home 778,609,
  // products 744,357, a new product 1,868,975, orders 762,732, pages 1,741,320, a page in the builder 3,135,169, settings 716,511 bytes;
  // about 4 % of room, rounded up to 10,000. Lowered from the 10 November budgets below, never raised.
  "": 810_000,
  "/products": 780_000,
  "/products/new": 1_250_000,
  "/orders": 800_000,
  "/pages": 790_000,
  "/pages/{page}": 3_270_000,
  "/pages/{page}/preview": 1_020_000,
  "/content": 750_000,
  "/settings": 750_000,
};

for (const [path, max] of Object.entries(BUDGETS)) {
  test(`the admin's ${path || "home"} first scripts stay within their budget`, async ({ page }) => {
    let address = path;
    if (path.includes("{page}")) {
      const sql = testDb();
      try {
        const [row] = await sql`
          select p.id from commerce.pages p join commerce.stores s on s.id = p.store_id
          where s.slug = ${E2E_STORE} and p.type = 'page' order by p.created_at limit 1`;
        address = path.replace("{page}", String(row.id));
      } finally {
        await sql.end();
      }
    }
    await page.goto(`/admin/${E2E_STORE}${address}`);
    await expect(page.locator("main").first()).toBeVisible();
    const total = await firstScripts(page, `/admin/${E2E_STORE}${address}`);
    if (MEASURE) console.log(`[admin-scripts] ${path || "/"} ${total} ${page.url()}`);
    else expect(total, `${path || "/"} first scripts: ${total} bytes`).toBeLessThan(max);
  });
}

/**
 * What a signed-in screen is handed (bloat review step 1.5, `docs/performance.md` *The admin as people use it*): five screens, for an
 * English and a Norwegian account, three figures each, held in `admin-handed.baseline.json` (`docs/rules/budgets.md`). The document is
 * the server's HTML. The words handed are the `texts` objects `AdminAreas` gives `AdminTextProvider` (`admin-text-context.tsx`), read
 * from the flight payload the document carries. The script by idle is every script the page fetched until three quiet seconds.
 * The document and the script allow 5 % and the words max(2,000 bytes, 5 %), as the admin is rebuilt daily; a figure that falls is written
 * into the baseline in the same change (`E2E_MEASURE=1` prints them); one that must rise is the owner's call. The English owner's home
 * and orders documents are measured as CI sees them, after the other specs have filled `e2e-shop`; the Norwegian owner's store is untouched.
 */
type Lang = "en" | "nb";
type ScreenKey = "home" | "orders" | "product" | "builder" | "platform";

const SCREENS: { key: ScreenKey; path: (store: string, ids: { product: string; page: string }) => string }[] = [
  { key: "home", path: (store) => `/admin/${store}` },
  { key: "orders", path: (store) => `/admin/${store}/orders` },
  { key: "product", path: (store, ids) => `/admin/${store}/products/${ids.product}` },
  { key: "builder", path: (store, ids) => `/admin/${store}/pages/${ids.page}` },
  { key: "platform", path: () => "/admin/platform" },
];

const PEOPLE = {
  en: { owner: OWNER, admin: ADMIN, store: E2E_STORE },
  nb: { owner: OWNER_NB, admin: ADMIN_NB, store: E2E_STORE_NB },
} as const;

/**
 * The first product and the first page of a store, as the screens' addresses name them. A store's rows are made in one statement, so
 * `created_at` ties and the ids are random: the handle and the slug settle which, the same in every database.
 */
async function idsOf(store: string): Promise<{ product: string; page: string }> {
  const sql = testDb();
  try {
    const [product] = await sql`
      select p.id from commerce.products p join commerce.stores s on s.id = p.store_id where s.slug = ${store} order by p.created_at, p.handle limit 1`;
    const [page] = await sql`
      select p.id from commerce.pages p join commerce.stores s on s.id = p.store_id
      where s.slug = ${store} and p.type = 'page' order by p.created_at, p.slug limit 1`;
    return { product: String(product.id), page: String(page.id) };
  } finally {
    await sql.end();
  }
}

/** The balanced JSON object that starts at `from` (an opening brace) in `text`, skipping string contents and escaped quotes. */
function balancedObject(text: string, from: number): string {
  let depth = 0;
  let inString = false;
  for (let i = from; i < text.length; i += 1) {
    const char = text[i];
    if (inString) {
      if (char === "\\") i += 1;
      else if (char === '"') inString = false;
    } else if (char === '"') inString = true;
    else if (char === "{") depth += 1;
    else if (char === "}") {
      depth -= 1;
      if (depth === 0) return text.slice(from, i + 1);
    }
  }
  throw new Error("an unbalanced texts object in the payload");
}

/**
 * The bytes of the `texts` objects in the document's flight payload (the prop `AdminTextProvider` is given), and the top-level keys
 * (the areas) they hold.
 */
function handedOf(html: string): { handed: number; areas: string[] } {
  const joined = [...html.matchAll(/<script[^>]*>(self\.__next_f\.push\([\s\S]*?\))<\/script>/g)]
    .map((match) => {
      const call = match[1];
      const parts = JSON.parse(call.slice(call.indexOf("(") + 1, call.lastIndexOf(")"))) as unknown[];
      return typeof parts[1] === "string" ? parts[1] : "";
    })
    .join("");
  let handed = 0;
  const areas = new Set<string>();
  for (let at = joined.indexOf('"texts":{'); at !== -1; at = joined.indexOf('"texts":{', at + 1)) {
    const object = balancedObject(joined, at + '"texts":'.length);
    // Other props are called `texts` too (a count's plural forms, `{ one, many }`, and empty ones, one per row): the words are objects of
    // areas, each an object of groups, and those two kinds change with the store's rows, not with the words.
    const found = JSON.parse(object) as Record<string, unknown>;
    const keys = Object.keys(found);
    if (keys.length === 0 || !keys.every((key) => typeof found[key] === "object" && found[key] !== null)) continue;
    handed += Buffer.byteLength(object);
    for (const key of keys) areas.add(key);
  }
  return { handed, areas: [...areas].sort() };
}

/** The bytes of every script the page fetches until nothing has started or finished for three seconds (each address once). */
async function scriptByIdle(browser: Browser, state: string, address: string, lang: Lang): Promise<number> {
  const context = await browser.newContext({ storageState: state });
  try {
    const page = await context.newPage();
    const sizes = new Map<string, number>();
    const pending: Promise<void>[] = [];
    let last = Date.now();
    const recent: string[] = [];
    const touch = (url: string) => {
      last = Date.now();
      recent.push(url);
      if (recent.length > 5) recent.shift();
    };
    page.on("request", (request) => touch(request.url()));
    page.on("requestfinished", (request) => touch(request.url()));
    page.on("requestfailed", (request) => touch(request.url()));
    page.on("response", (response) => {
      if (response.request().resourceType() !== "script" || sizes.has(response.url())) return;
      sizes.set(response.url(), 0);
      pending.push(
        response.body().then(
          (body) => void sizes.set(response.url(), body.length),
          () => undefined,
        ),
      );
    });
    await page.goto(address, { waitUntil: "load" });
    const started = Date.now();
    while (Date.now() - last < 3000) {
      if (Date.now() - started > 30_000) throw new Error(`${address} was not idle after 30 s; last requests: ${recent.join(" ")}`);
      await page.waitForTimeout(250);
    }
    await Promise.all(pending);
    if (lang === "nb") await expect(page.locator("html")).toHaveAttribute("lang", "nb");
    return [...sizes.values()].reduce((sum, size) => sum + size, 0);
  } finally {
    await context.close();
  }
}

type Figures = { document: number; handed: number; scriptByIdle: number };
const measured: Record<Lang, Partial<Record<ScreenKey, Figures>>> = { en: {}, nb: {} };

test.describe("what a signed-in screen is handed", () => {
  // The baseline's room: the admin is rebuilt every day, so the document and the script by idle may be 5 % over and the words
  // max(2,000 bytes, 5 %) over; a whole area handed by mistake (20 KB or more) still fails. A fall is a note.
  for (const lang of ["en", "nb"] as const) {
    for (const screen of SCREENS) {
      test(`${screen.key} in ${lang === "en" ? "English" : "Norwegian"}`, async ({ browser }) => {
        const people = PEOPLE[lang];
        const state = screen.key === "platform" ? people.admin.state : people.owner.state;
        const address = screen.path(people.store, screen.key === "product" || screen.key === "builder" ? await idsOf(people.store) : { product: "", page: "" });
        const context = await browser.newContext({ storageState: state });
        let html = "";
        try {
          html = await (await context.request.get(address)).text();
        } finally {
          await context.close();
        }
        const { handed, areas } = handedOf(html);
        const figures: Figures = { document: html.length, handed, scriptByIdle: await scriptByIdle(browser, state, address, lang) };
        measured[lang][screen.key] = figures;
        if (MEASURE) {
          console.log(`[handed] ${lang} ${screen.key} ${figures.document} ${figures.handed} ${figures.scriptByIdle} ${areas.join(",")}`);
          return;
        }
        const held = baseline[lang][screen.key];
        const lower = "lower the baseline in the same change when a figure falls: E2E_MEASURE=1 prints them";
        const where = `${screen.key} in ${lang}`;
        expect(figures.document, `${where}: document ${figures.document} bytes, baseline ${held.document}; ${lower}`).toBeLessThanOrEqual(held.document * 1.05);
        expect(figures.handed, `${where}: words handed ${figures.handed} bytes, baseline ${held.handed}; ${lower}`).toBeLessThanOrEqual(held.handed + Math.max(2_000, held.handed * 0.05));
        expect(figures.scriptByIdle, `${where}: script by idle ${figures.scriptByIdle} bytes, baseline ${held.scriptByIdle}; ${lower}`).toBeLessThanOrEqual(
          held.scriptByIdle * 1.05,
        );
      });
    }
  }

  for (const lang of ["en", "nb"] as const) {
    test(`notes a screen far under its baseline in ${lang === "en" ? "English" : "Norwegian"}`, () => {
      test.skip(MEASURE, "E2E_MEASURE prints the figures and asserts nothing");
      for (const screen of SCREENS) {
        const figures = measured[lang][screen.key];
        test.skip(!figures, "the screens run in this worker first");
        const held = baseline[lang][screen.key];
        for (const name of ["document", "handed", "scriptByIdle"] as const) {
          // The English owner's home and orders list grow with what the specs that ran before made in their store (188 KB alone, 216 KB
          // after the whole suite): their document's baseline is what CI sees, and only a quiet run is far under it.
          if (name === "document" && lang === "en" && (screen.key === "home" || screen.key === "orders")) continue;
          if (figures![name] < held[name] * 0.95) console.info(`[handed] ${screen.key} in ${lang}: ${name} is ${figures![name]}, more than 5 % under its baseline ${held[name]}; write the lower figure into admin-handed.baseline.json`);
        }
      }
    });
  }
});

/**
 * What a save answers with (the English owner only): the bytes of the response to the server action that saves the product editor
 * and the page builder, recorded in the baseline (`saves`) and held to 5 %. The smallest real change is one more character in the
 * title; the title is set back and saved again, so the store is left as it was. A save that makes more than one action request is
 * measured by the one that carries the changed title (the builder's title also asks for a preview and a follow-up).
 */
test.describe("what a save answers with", () => {
  test.setTimeout(90_000);
  /**
   * Presses Save and returns the bytes of the answer to the save's own server action: the action request that carries the changed
   * title (a builder's title also makes a preview action and a follow-up, which do not).
   */
  async function saveAnswer(page: Page, press: () => Promise<void>, changed: string): Promise<number> {
    const answers: number[] = [];
    const onResponse = (response: Response) => {
      const request = response.request();
      if (request.method() !== "POST" || request.headers()["next-action"] === undefined) return;
      if (!(request.postData() ?? "").includes(changed)) return;
      void response.body().then((body) => void answers.push(body.length), () => undefined);
    };
    page.on("response", onResponse);
    try {
      // A press before the screen has hydrated does nothing (the typed words are put back too): change and press again until it answers.
      await expect(async () => {
        await press();
        await expect.poll(() => answers.length, { timeout: 6000 }).toBeGreaterThan(0);
      }).toPass({ timeout: 40_000 });
      await page.waitForTimeout(1000);
      return Math.max(...answers);
    } finally {
      page.off("response", onResponse);
    }
  }

  function check(name: "product" | "builder", answer: number) {
    if (MEASURE) {
      console.log(`[save] ${name} ${answer}`);
      return;
    }
    const held = baseline.saves[name];
    expect(answer, `the ${name} save's answer is ${answer} bytes, baseline ${held}; lower the baseline in the same change when a figure falls: E2E_MEASURE=1 prints them`).toBeLessThanOrEqual(held * 1.05);
  }

  test("the product editor's save", async ({ page }) => {
    const { product } = await idsOf(E2E_STORE);
    await page.goto(`/admin/${E2E_STORE}/products/${product}`);
    const title = page.getByLabel("Title", { exact: true });
    const before = await title.inputValue();
    try {
      const answer = await saveAnswer(
        page,
        async () => {
          await title.fill(`${before}x`);
          await page.getByRole("button", { name: "Save", exact: true }).first().click();
        },
        `${before}x`,
      );
      await expect(page.getByText("Saved.").first()).toBeVisible();
      check("product", answer);
    } finally {
      await title.fill(before);
      await page.getByRole("button", { name: "Save", exact: true }).first().click();
      await expect(page.getByText("Saved.").first()).toBeVisible();
    }
    await page.reload();
    await expect(page.getByLabel("Title", { exact: true })).toHaveValue(before);
  });

  test("the builder's save", async ({ page }) => {
    const { page: pageId } = await idsOf(E2E_STORE);
    await page.goto(`/admin/${E2E_STORE}/pages/${pageId}`);
    await expect(page.locator("[data-editor-bar]")).toBeVisible();
    const title = page.getByLabel("Title", { exact: true });
    const before = await title.inputValue();
    const saved = page.getByRole("status").filter({ hasText: "Draft saved." });
    try {
      const answer = await saveAnswer(
        page,
        async () => {
          await title.fill(`${before}x`);
          await page.getByRole("button", { name: "Save draft" }).click();
        },
        `${before}x`,
      );
      await expect(saved).toBeVisible();
      check("builder", answer);
    } finally {
      await title.fill(before);
      await page.getByRole("button", { name: "Save draft" }).click();
      await expect(saved).toBeVisible();
    }
    await page.reload();
    await expect(page.getByLabel("Title", { exact: true })).toHaveValue(before);
  });
});
