import { expect, test, type Page } from "@playwright/test";

import { E2E_STORE, OWNER } from "./accounts";

/**
 * Forms that answer (code review 1.15, D829), as the store's owner meets them. A refused field shows its problem right under it (after its
 * hint), marked and described by it, and the page brings it into view and moves the focus there; the list at the form's foot leaves it out.
 * *Saved* goes away on the first edit after it. A form that answers by what it does (`QuietActionForm`: a customer's tags) is busy while it
 * posts, takes no second submission, and clears its field once it worked. Only refusals are sent to the company's details, so the store is
 * left as it was found.
 */
test.use({ storageState: OWNER.state });

const RUN = Date.now().toString(36).toLowerCase();

/** Holds each server action posted from `path` back a moment, so what the form shows while it works can be seen; counts them. */
async function slowActions(page: Page, path: string): Promise<{ posts: () => number }> {
  let posts = 0;
  await page.route(
    (url) => url.pathname === path,
    async (route) => {
      const request = route.request();
      if (request.method() === "POST" && request.headers()["next-action"] !== undefined) {
        posts += 1;
        await new Promise((done) => setTimeout(done, 1_500));
      }
      await route.continue();
    },
  );
  return { posts: () => posts };
}

test("a refused field shows its problem under it, in view and focused", async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 600 });
  await page.goto(`/admin/${E2E_STORE}/settings/company`);
  await page.locator("details", { has: page.locator("#store-name") }).locator("summary").click();
  const form = page.locator("form", { has: page.locator("#store-name") });
  const name = form.getByLabel("Store name");
  // What the server checks besides the name, filled where the store has none yet: a refusal saves nothing.
  const legal = form.getByLabel("Legal name of the business");
  if (!(await legal.inputValue()).trim()) await legal.fill("E2E Shop AS");
  const address = form.getByLabel("Registered business address");
  if ((await address.inputValue()).trim().length < 5) await address.fill("Storgata 1\n0155 Oslo");
  const country = form.getByLabel("Country the business is registered in");
  if (!(await country.inputValue())) await country.selectOption("NO");
  // Spaces pass the browser's own check; the server trims them away and names the field.
  await name.fill("   ");
  const save = form.getByRole("button", { name: "Save business details" });
  await save.evaluate((button) => button.scrollIntoView({ block: "start" }));
  await expect(name).not.toBeInViewport();
  await save.click();

  const problem = form.locator('[data-problem="name"]');
  await expect(problem).toHaveText("Enter the store's name.");
  await expect(name).toHaveAttribute("aria-invalid", "true");
  await expect(name).toBeFocused();
  await expect(name).toBeInViewport();
  await expect(problem).toBeInViewport();
  expect((await name.getAttribute("aria-describedby"))?.split(" ")).toEqual(["store-name-hint", await problem.getAttribute("id")]);
  const [field, hint, line] = await Promise.all([name.boundingBox(), form.locator("#store-name-hint").boundingBox(), problem.boundingBox()]);
  expect(hint!.y).toBeGreaterThan(field!.y);
  expect(line!.y).toBeGreaterThan(hint!.y);
  await expect(form.getByRole("status")).not.toContainText("Enter the store's name.");
});

test("a quiet form is busy while it posts and clears its field; Saved goes away on the next edit", async ({ page }) => {
  await page.goto(`/admin/${E2E_STORE}/customers/new`);
  await page.getByLabel("Email", { exact: true }).fill(`e2e-answer-${RUN}@example.com`);
  await page.getByLabel("Name", { exact: true }).fill("Anna Answer");
  await page.getByRole("button", { name: "Add customer" }).click();
  await expect(page).toHaveURL(new RegExp(`/admin/${E2E_STORE}/customers/[0-9a-f-]{36}$`));
  const slow = await slowActions(page, new URL(page.url()).pathname);

  const tags = page.getByRole("region", { name: "Tags" });
  const tag = `e2e-answer-${RUN}`;
  const box = tags.getByRole("textbox", { name: "New tag" });
  const adding = tags.locator("form", { has: page.getByRole("textbox", { name: "New tag" }) });
  await box.fill(tag);
  await tags.getByRole("button", { name: "Add", exact: true }).click();
  // While it works: busy, its button says so, and a second submission is not sent.
  await expect(adding).toHaveAttribute("aria-busy", "true");
  await expect(adding.getByRole("button")).toBeDisabled();
  await expect(adding.getByRole("button")).toHaveText("Working …");
  await adding.evaluate((form: HTMLFormElement) => form.requestSubmit());
  await expect(adding).toHaveAttribute("aria-busy", "false", { timeout: 30_000 });
  await expect(tags.getByRole("list", { name: "Tags" }).getByText(tag)).toBeVisible();
  await expect(box).toHaveValue("");
  expect(slow.posts()).toBe(1);

  // A button drawn by the server page: the form is busy and the button pressed is marked, so it spins.
  const remove = tags.getByRole("button", { name: `Remove the tag ${tag}` });
  await remove.click();
  await expect(tags.locator("form", { has: page.getByRole("button", { name: `Remove the tag ${tag}` }) })).toHaveAttribute("aria-busy", "true");
  await expect(remove).toHaveAttribute("data-submitting", "");
  await expect(tags.getByText(tag)).toHaveCount(0, { timeout: 30_000 });
  await page.unrouteAll({ behavior: "wait" });

  await page.getByText("Edit details", { exact: true }).click();
  const edit = page.getByRole("region", { name: "Edit details" });
  const phone = edit.getByLabel("Phone");
  await phone.fill("+47 400 00 829");
  await edit.getByRole("button", { name: "Save details" }).click();
  await expect(edit.getByRole("status")).toHaveText("Details saved.", { timeout: 30_000 });
  await phone.pressSequentially("1");
  await expect(edit.getByRole("status")).toHaveText("");
});
