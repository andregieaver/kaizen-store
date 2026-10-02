import { expect, test } from "@playwright/test";

/**
 * The admin's look (D149), seen on its sign-in page, which needs no session: the document is marked as the admin, the page is
 * tinted rather than white, a focused field gets the brand ring, the main action lifts when pointed at, a form that is working
 * says so, and the storefront is untouched. Reduced motion stills it.
 */

const computed = (page: import("@playwright/test").Page, selector: string, property: string) =>
  page.locator(selector).first().evaluate((el, p) => getComputedStyle(el).getPropertyValue(p), property);

test("the admin is marked, tinted and has a brand colour, in light and in dark", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto("/admin/sign-in");
  await expect(page.locator("html")).toHaveAttribute("data-admin", "");
  const brand = (await computed(page, "html", "--brand-solid")).trim();
  expect(brand).toBe("#4f46e5");
  // The page behind the cards is tinted, not white; the cards stay white.
  const canvas = await computed(page, "body", "background-color");
  expect(canvas).not.toBe("rgb(255, 255, 255)");
  expect((await computed(page, "html", "--background")).trim()).toBe("#fff");

  await page.emulateMedia({ colorScheme: "dark" });
  await page.reload();
  expect((await computed(page, "html", "--brand-solid")).trim()).toBe("#5b5fe8");
  expect((await computed(page, "body", "background-color"))).toBe("rgb(11, 14, 24)");
  await page.screenshot({ path: "test-results/admin-look-dark.png" });
});

test("a focused field gets the brand ring, and the main action lifts when pointed at", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light", reducedMotion: "no-preference" });
  await page.goto("/admin/sign-in");
  const email = page.getByLabel("Email");
  const before = await email.evaluate((el) => getComputedStyle(el).boxShadow);
  await email.focus();
  await expect.poll(() => email.evaluate((el) => getComputedStyle(el).boxShadow)).toContain("rgba(79, 70, 229");
  await expect.poll(() => email.evaluate((el) => getComputedStyle(el).borderColor)).toBe("rgb(79, 70, 229)");
  expect(before).not.toContain("rgba(79, 70, 229");

  // The main action (the page's `bg-foreground` button) is the brand colour, and moves up a pixel when pointed at.
  const action = page.getByRole("button", { name: "Sign in", exact: true });
  expect(await action.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe("rgb(79, 70, 229)");
  await action.hover();
  await expect.poll(() => action.evaluate((el) => getComputedStyle(el).transform)).not.toBe("none");
  await page.screenshot({ path: "test-results/admin-look-light.png" });
});

test("a field the browser judges wrong, once touched, turns red", async ({ page }) => {
  await page.goto("/admin/sign-in");
  const email = page.getByLabel("Email");
  await email.fill("not an email");
  await page.getByLabel("Password", { exact: true }).focus();
  await expect.poll(() => email.evaluate((el) => getComputedStyle(el).borderColor)).toBe("rgb(185, 28, 28)");
});

test("the bar along the top is there, and reduced motion stills the admin's animations", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/admin/sign-in");
  await expect(page.locator(".admin-progress")).toHaveCount(1);
  const durations = await page.locator("main > *").first().evaluate((el) => getComputedStyle(el).animationDuration);
  expect(parseFloat(durations)).toBeLessThan(0.01);
});

test("the storefront keeps its own look: no admin attribute, no admin colours", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("html")).not.toHaveAttribute("data-admin", /.*/);
  expect((await computed(page, "html", "--brand-solid")).trim()).toBe("");
});
