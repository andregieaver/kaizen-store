import { expect, test } from "@playwright/test";

import { storePageWith } from "./db";

/**
 * Editing a page's words where they stand (D192) is for signed-in staff; this is what everyone else gets. The page carries the markers the
 * editor looks for and nothing else: no button, no editor fetched, no call to the server's editing route, and that route refuses a
 * request with no session. (The end e2e never signs in to the admin; what a signed-in person does is held by the integration test of
 * `page-text-edit.ts` and the editor's own tests.)
 */

const doc = (words: string) => ({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: words }] }] });

async function arranged() {
  const url = await storePageWith("liveedit", [
    { id: "h1", type: "heading", text: "Velkommen hit", level: 1 },
    { id: "t1", type: "richText", doc: doc("Noen ord å lese") },
    { id: "b1", type: "button", label: "Gå videre", href: "/" },
  ]);
  return { url, store: url.split("/")[2] };
}

test("a visitor's page carries the markers and no editor", async ({ page }) => {
  const { url } = await arranged();
  const calls: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("/api/platform/editor")) calls.push(request.url());
  });
  await page.goto(url);

  // The markers: the page's id on its article, the kind and id of each heading and text.
  const id = await page.locator("article[data-kz-page]").getAttribute("data-kz-page");
  expect(id).toMatch(/^[0-9a-f-]{36}$/);
  await expect(page.locator('[data-kz-edit="heading"][data-kz-block="h1"]')).toHaveCount(1);
  await expect(page.locator('[data-kz-edit="richText"][data-kz-block="t1"]')).toHaveCount(1);
  // A button is not edited in place.
  await expect(page.locator('[data-kz-block="b1"]')).toHaveCount(0);

  // Nothing is offered and nothing is asked: no "Edit text", no "Edit page", no call to the editing routes.
  await expect(page.getByRole("button", { name: "Edit text" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Edit page" })).toHaveCount(0);
  // Pressing the heading does what it always did: nothing becomes editable.
  await page.getByRole("heading", { name: "Velkommen hit" }).click();
  await expect(page.locator("[contenteditable]")).toHaveCount(0);
  await expect(page.locator("[data-kz-active]")).toHaveCount(0);
  expect(calls).toEqual([]);
});

test("the editing route refuses a request with no session, and one from another site", async ({ page, request }) => {
  const { url, store } = await arranged();
  await page.goto(url);
  const id = (await page.locator("article[data-kz-page]").getAttribute("data-kz-page"))!;
  const query = `store=${store}&page=${id}&block=h1`;

  const read = await request.get(`/api/platform/editor/text?${query}`);
  expect(read.status()).toBe(403);
  expect(await read.json()).toMatchObject({ ok: false, code: "forbidden" });

  const save = await request.post("/api/platform/editor/text", {
    data: { store, page: id, block: "h1", rev: "0123456789abcdef", edit: { kind: "heading", text: "Overtatt" } },
  });
  expect(save.status()).toBe(403);
  expect(await save.json()).toMatchObject({ ok: false, code: "forbidden" });

  // Another site's page cannot ask either, signed in or not.
  const foreign = await request.post("/api/platform/editor/text", {
    headers: { Origin: "https://elsewhere.example" },
    data: { store, page: id, block: "h1", rev: "0123456789abcdef", edit: { kind: "heading", text: "Overtatt" } },
  });
  expect(foreign.status()).toBe(403);

  // Nothing was changed.
  await page.reload();
  await expect(page.getByRole("heading", { name: "Velkommen hit" })).toBeVisible();

  // What cannot be read is refused plainly, never answered with a page.
  const malformed = await request.get(`/api/platform/editor/text?store=${store}&page=not-a-page&block=h1`);
  expect(malformed.status()).toBe(400);
});
