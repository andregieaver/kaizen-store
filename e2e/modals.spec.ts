import { expect, test, type BrowserContext, type Page } from "@playwright/test";

import { testDb } from "./db";

/**
 * Modals in a page (D121): a row with a Modal setting is out of the page's flow and opens in a dialog by a link to
 * #modal-{key}, a class, a timer or exit intent. Arranged in the database, as the page builder saves it.
 */

const doc = (text: string) => ({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] });
const heading = (id: string, text: string, level = 2) => ({ id, type: "heading", text, level });
const text = (id: string, words: string, extra: Record<string, unknown> = {}) => ({
  id,
  type: "richText",
  doc: doc(words),
  ...extra,
});
const button = (id: string, label: string, href: string) => ({ id, type: "button", label, href });
const row = (id: string, blocks: unknown[], extra: Record<string, unknown> = {}) => ({
  id,
  type: "row",
  layout: "1",
  columns: [{ id: `${id}-c`, blocks }],
  ...extra,
});
/** A modal row: what is in it, and its setting. */
const modalRow = (key: string, blocks: unknown[], modal: Record<string, unknown>) =>
  row(`modal-${key}`, blocks, {
    modal: { key, frequency: "always", size: "md", triggers: { button: true }, ...modal },
  });

const content = (title: string, slug: string, rows: unknown[]) => ({
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

type Arranged = { slug: string; storeId: string; url: (page: string) => string };

/** A new store with published pages, and a footer if one is given. */
async function arrange(pages: ReturnType<typeof content>[], footer?: ReturnType<typeof content>): Promise<Arranged> {
  const slug = `modal-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  const sql = testDb();
  try {
    const [request] = await sql`
      insert into commerce.access_requests (email, name, store_name)
      values (${`${slug}@example.com`}, 'Siri', 'Modalbutikk') returning id`;
    const [{ id: storeId }] =
      await sql`select commerce.approve_access_request(${request.id}, ${slug}, 'Modalbutikk', null) as id`;
    const add = (type: string, value: ReturnType<typeof content>) => sql`
      insert into commerce.pages (store_id, type, slug, draft, published, published_at)
      values (${storeId}, ${type}, ${value.slug}, ${sql.json(value as never)}, ${sql.json(value as never)}, now()) returning id`;
    for (const page of pages) await add("page", page);
    if (footer) {
      const [{ id: footerId }] = await add("footer", footer);
      await sql`update commerce.stores set footer_id = ${footerId} where id = ${storeId}`;
    }
    return { slug, storeId, url: (page) => `/s/${slug}/no/${page}` };
  } finally {
    await sql.end();
  }
}

/** The visitor has allowed preferences on this store's site (D58), so a closing may be remembered. */
async function allowPreferences(context: BrowserContext, storeId: string, baseURL: string) {
  const visitor = "3f2b8c1e-7a4d-4b9e-9c2a-1d5e6f7a8b9c";
  await context.addCookies([{ name: `consent_${storeId}`, value: `1.${visitor}.preferences.100`, url: baseURL }]);
}

const opened = (page: Page, name?: string) => page.getByRole("dialog", name ? { name } : undefined);
const insideDialog = (page: Page) => page.evaluate(() => document.activeElement?.closest("dialog") != null);

test("a timer opens a modal by itself, which Escape and the close button close, and focus goes back", async ({
  page,
}) => {
  const shop = await arrange([
    content("Tilbud", "tilbud", [
      row("intro", [heading("h1", "Tilbudsside", 1), button("focus", "Fokuspunkt", "/s/x/no")]),
      modalRow("timer", [heading("mh", "Ti prosent"), text("mt", "Meld deg på og få ti prosent.")], {
        triggers: { timer: { seconds: 3 } },
      }),
    ]),
  ]);
  await page.goto(shop.url("tilbud"));

  // Not in the page's flow: its words are not there before it opens.
  const dialog = opened(page, "Ti prosent");
  await expect(page.getByText("Meld deg på og få ti prosent.")).toBeHidden();
  await expect(dialog).toHaveCount(0);
  const focus = page.getByRole("link", { name: "Fokuspunkt" });
  await focus.focus();

  await expect(dialog).toBeVisible({ timeout: 10_000 });
  await expect(dialog.getByText("Meld deg på og få ti prosent.")).toBeVisible();
  // The page behind stops scrolling while it is open.
  await expect(page.locator("html")).toHaveCSS("overflow", "hidden");
  expect(await insideDialog(page)).toBe(true);
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(focus).toBeFocused();
  await expect(page.locator("html")).not.toHaveCSS("overflow", "hidden");

  // Once a page view: it does not open again by itself.
  await page.waitForTimeout(3500);
  await expect(dialog).toBeHidden();

  // The close button closes it too.
  await page.reload();
  await page.getByRole("link", { name: "Fokuspunkt" }).focus();
  await expect(dialog).toBeVisible({ timeout: 10_000 });
  await dialog.getByRole("button", { name: "Lukk" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole("link", { name: "Fokuspunkt" })).toBeFocused();
});

test("a link to #modal-key opens it, a link inside it switches to another, and only one is open at a time", async ({
  page,
}) => {
  const shop = await arrange([
    content("Knapper", "knapper", [
      row("intro", [heading("h1", "Knappeside", 1), button("open", "Åpne tilbud", "#modal-promo")]),
      modalRow(
        "promo",
        [
          heading("ph", "Tilbud"),
          text("pt", "Skjult tilbudstekst"),
          button("to-news", "Til nyhetsbrev", "#modal-newsletter"),
        ],
        {},
      ),
      modalRow("newsletter", [heading("nh", "Nyhetsbrev"), text("nt", "Skjult nyhetsbrevtekst")], {}),
    ]),
  ]);
  await page.goto(shop.url("knapper"));
  await expect(page.getByText("Skjult tilbudstekst")).toBeHidden();
  await expect(opened(page)).toHaveCount(0);
  const history = await page.evaluate(() => window.history.length);

  await page.getByRole("link", { name: "Åpne tilbud" }).click();
  const promo = opened(page, "Tilbud");
  await expect(promo).toBeVisible();
  await expect(page).toHaveURL(/#modal-promo$/);
  expect(await insideDialog(page)).toBe(true);
  // The page did not jump, and the visitor cannot tab out of the dialog.
  await page.keyboard.press("Tab");
  expect(await insideDialog(page)).toBe(true);

  // From inside it to the other: one at a time.
  await promo.getByRole("link", { name: "Til nyhetsbrev" }).click();
  await expect(opened(page, "Nyhetsbrev")).toBeVisible();
  await expect(promo).toBeHidden();
  await expect(opened(page)).toHaveCount(1);

  // Closing takes the address away, without a history entry of its own.
  await page.keyboard.press("Escape");
  await expect(opened(page)).toHaveCount(0);
  await expect(page).not.toHaveURL(/#modal-/);
  expect(await page.evaluate(() => window.history.length)).toBe(history);
});

test("a modal opens from an address with its hash, and from an element with its class", async ({ page }) => {
  const shop = await arrange([
    content("Klasse", "klasse", [
      row("intro", [
        heading("h1", "Klasseside", 1),
        text("t", "Trykk her for nyhetsbrevet", { className: "open-newsletter" }),
        button("quiet", "Til stille", "#modal-stille"),
      ]),
      modalRow("newsletter", [heading("nh", "Nyhetsbrev"), text("nt", "Nyhetsbrevets tekst")], {
        triggers: { className: "open-newsletter" },
      }),
      modalRow("hash", [heading("hh", "Fra adressen"), text("ht", "Åpnet av adressen")], {}),
      // Set to open by a class only: a link to it does nothing.
      modalRow("stille", [heading("sh", "Stille modal"), text("st", "Åpnes ikke av lenker")], {
        triggers: { className: "never-used" },
      }),
    ]),
  ]);
  await page.goto(shop.url("klasse"));
  await expect(opened(page)).toHaveCount(0);
  await page.getByText("Trykk her for nyhetsbrevet").click();
  await expect(opened(page, "Nyhetsbrev")).toBeVisible();
  await page.getByRole("button", { name: "Lukk" }).click();
  await expect(opened(page)).toHaveCount(0);

  await page.getByRole("link", { name: "Til stille" }).click();
  await page.waitForTimeout(300);
  await expect(opened(page)).toHaveCount(0);

  // Followed to the page, or entered in the address bar afterwards.
  await page.goto(`${shop.url("klasse")}?open=1#modal-hash`);
  await expect(opened(page, "Fra adressen")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(opened(page)).toHaveCount(0);
  await page.evaluate(() => {
    window.location.hash = "#modal-hash";
  });
  await expect(opened(page, "Fra adressen")).toBeVisible();
});

test("exit intent opens it when the pointer leaves the top, but not in the first seconds", async ({ page }) => {
  const shop = await arrange([
    content("Utgang", "utgang", [
      row("intro", [heading("h1", "Utgangsside", 1), text("t", "Innhold")]),
      modalRow("exit", [heading("eh", "Vent litt"), text("et", "Før du går")], { triggers: { exitIntent: true } }),
    ]),
  ]);
  const leave = () =>
    page.evaluate(() =>
      document.dispatchEvent(new MouseEvent("mouseout", { clientY: 0, relatedTarget: null, bubbles: true })),
    );
  await page.goto(shop.url("utgang"));
  // Too soon.
  await leave();
  await page.waitForTimeout(300);
  await expect(opened(page)).toHaveCount(0);

  await page.waitForTimeout(3200);
  // Out of the side of the window, or into another element, is not leaving.
  await page.evaluate(() =>
    document.dispatchEvent(new MouseEvent("mouseout", { clientY: 300, relatedTarget: null, bubbles: true })),
  );
  await page.waitForTimeout(200);
  await expect(opened(page)).toHaveCount(0);

  await leave();
  await expect(opened(page, "Vent litt")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(opened(page)).toHaveCount(0);
  // Once a page view.
  await leave();
  await page.waitForTimeout(300);
  await expect(opened(page)).toHaveCount(0);
});

test("a modal shown once per visit is not opened again by itself, but a link still opens it", async ({
  page,
  context,
  baseURL,
}) => {
  const shop = await arrange([
    content("Sesjon", "sesjon", [
      row("intro", [heading("h1", "Sesjonsside", 1), button("open", "Åpne igjen", "#modal-sesjon")]),
      modalRow("sesjon", [heading("sh", "Én gang"), text("st", "Vises én gang per besøk")], {
        triggers: { timer: { seconds: 1 }, button: true },
        frequency: "session",
      }),
    ]),
  ]);
  await allowPreferences(context, shop.storeId, baseURL!);
  await page.goto(shop.url("sesjon"));
  const dialog = opened(page, "Én gang");
  await expect(dialog).toBeVisible({ timeout: 10_000 });
  // Nothing is kept until the visitor closes it.
  expect(await page.evaluate(() => Object.keys(sessionStorage).filter((k) => k.startsWith("kaizen_modal_")))).toEqual(
    [],
  );
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  expect(await page.evaluate(() => sessionStorage.getItem("kaizen_modal_sesjon"))).toBe("1");

  await page.reload();
  await page.waitForTimeout(2500);
  await expect(dialog).toHaveCount(0);
  // Asked for by a link it opens all the same.
  await page.getByRole("link", { name: "Åpne igjen" }).click();
  await expect(dialog).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
});

test("a modal shown every so many days is remembered in local storage", async ({ page, context, baseURL }) => {
  const shop = await arrange([
    content("Dager", "dager", [
      row("intro", [heading("h1", "Dagerside", 1)]),
      modalRow("dager", [heading("dh", "Hver uke"), text("dt", "Vises hver sjuende dag")], {
        triggers: { timer: { seconds: 1 } },
        frequency: "days",
        days: 7,
      }),
    ]),
  ]);
  await allowPreferences(context, shop.storeId, baseURL!);
  await page.goto(shop.url("dager"));
  const dialog = opened(page, "Hver uke");
  await expect(dialog).toBeVisible({ timeout: 10_000 });
  await page.getByRole("button", { name: "Lukk" }).click();
  const closedAt = Number(await page.evaluate(() => localStorage.getItem("kaizen_modal_dager")));
  expect(Date.now() - closedAt).toBeLessThan(60_000);
  await page.reload();
  await page.waitForTimeout(2500);
  await expect(dialog).toHaveCount(0);
});

test("without allowing preferences nothing is stored, and the modal stays closed until the page is loaded again", async ({
  page,
}) => {
  const shop = await arrange([
    content("Uten", "uten", [
      row("intro", [heading("h1", "Utensiden", 1)]),
      modalRow("uten", [heading("uh", "Uten lagring"), text("ut", "Ingenting huskes")], {
        triggers: { timer: { seconds: 1 } },
        frequency: "session",
      }),
    ]),
  ]);
  await page.goto(shop.url("uten"));
  const dialog = opened(page, "Uten lagring");
  await expect(dialog).toBeVisible({ timeout: 10_000 });
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  const kept = await page.evaluate(() =>
    [...Object.keys(sessionStorage), ...Object.keys(localStorage)].filter((k) => k.startsWith("kaizen_modal_")),
  );
  expect(kept).toEqual([]);
  // The site lists what it would keep, and asks about it.
  await expect(page.getByRole("button", { name: "Godta alle" })).toBeVisible();
});

test("a modal in the footer is on every page of the store, and opens by its link on each", async ({ page }) => {
  const footer = content("Bunn", "bunn", [
    row("f", [
      { id: "b", type: "site", part: "business" },
      { id: "k", type: "site", part: "cookies" },
      button("fo", "Fotertilbud", "#modal-footer-offer"),
    ]),
    modalRow("footer-offer", [heading("fh", "Tilbud i foten"), text("ft", "Gjelder hele butikken")], {}),
  ]);
  const shop = await arrange(
    [
      content("Første", "forste", [row("a", [heading("h1", "Første side", 1)])]),
      content("Andre", "andre", [row("b", [heading("h1", "Andre side", 1)])]),
    ],
    footer,
  );
  for (const name of ["forste", "andre"]) {
    await page.goto(shop.url(name));
    await expect(page.getByText("Gjelder hele butikken")).toBeHidden();
    await page.locator(".site-footer").getByRole("link", { name: "Fotertilbud" }).click();
    const dialog = opened(page, "Tilbud i foten");
    await expect(dialog).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
  }
});

test("a modal with a sign-up form in it can be used", async ({ page }) => {
  const stamp = Date.now().toString(36);
  const subscriber = `modal-${stamp}@example.com`;
  const shop = await arrange([
    content("Nyhetsbrev", "nyhetsbrev", [
      row("intro", [heading("h1", "Nyhetsbrevside", 1), button("open", "Meld deg på", "#modal-nyhetsbrev")]),
      modalRow(
        "nyhetsbrev",
        [
          heading("nh", "Få nyheter"),
          {
            id: `news-${stamp}`,
            type: "newsletter",
            recipients: [`liste-${stamp}@example.com`],
            placeholder: "",
            submitLabel: "",
            successMessage: "",
            consent: "",
          },
        ],
        {},
      ),
    ]),
  ]);
  await page.goto(shop.url("nyhetsbrev"));
  await page.getByRole("link", { name: "Meld deg på" }).click();
  const dialog = opened(page, "Få nyheter");
  await expect(dialog).toBeVisible();
  await dialog.getByRole("textbox", { name: "E-post" }).fill(subscriber);
  // People take a moment: a form sent at once is taken for a robot's.
  await page.waitForTimeout(2100);
  await dialog.getByRole("button", { name: "Meld meg på" }).click();
  await expect(dialog.getByText("Kryss av for å fortsette.")).toBeVisible();
  await dialog.getByLabel(/send meg nyhetsbrev/).check();
  await dialog.getByRole("button", { name: "Meld meg på" }).click();
  await expect(dialog.getByRole("status")).toContainText("Vi har sendt deg en e-post");

  const sql = testDb();
  try {
    const [email] = await sql`select text from commerce.email_messages where to_address = ${subscriber}`;
    expect(String(email.text)).toContain("/api/forms/confirm?t=");
  } finally {
    await sql.end();
  }
});

test("two modals that open by a timer at once: only one opens", async ({ page }) => {
  const shop = await arrange([
    content("To", "to", [
      row("intro", [heading("h1", "Tosiden", 1)]),
      modalRow("en", [heading("eh", "Første modal")], { triggers: { timer: { seconds: 1 } } }),
      modalRow("to", [heading("th", "Andre modal")], { triggers: { timer: { seconds: 1 } } }),
    ]),
  ]);
  await page.goto(shop.url("to"));
  await expect(opened(page)).toHaveCount(1, { timeout: 10_000 });
  await page.waitForTimeout(1500);
  await expect(opened(page)).toHaveCount(1);
});
