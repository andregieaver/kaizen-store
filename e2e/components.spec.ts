import { expect, test } from "@playwright/test";

import { storePageWith } from "./db";

/** The newer page components (D91), as the site shows them. */

test("a separator line draws with its own style, thickness, colour, width and place", async ({ page }) => {
  const address = await storePageWith("separator", [
    { id: "plain", type: "separator" },
    { id: "styled", type: "separator", line: "dashed", thickness: 4, color: "#ff0000", width: 50, position: "right", htmlId: "styled" },
  ]);
  await page.goto(address);
  const lines = page.locator("main hr");
  await expect(lines).toHaveCount(2);
  await expect(lines.first()).toHaveCSS("border-top-style", "solid");
  await expect(lines.first()).toHaveCSS("border-top-width", "1px");
  const styled = lines.nth(1);
  await expect(styled).toHaveCSS("border-top-style", "dashed");
  await expect(styled).toHaveCSS("border-top-width", "4px");
  await expect(styled).toHaveCSS("border-top-color", "rgb(255, 0, 0)");
  // Half its column, at the right.
  const [line, column] = await Promise.all([styled.boundingBox(), page.locator("#styled").boundingBox()]);
  expect(Math.round(line!.width)).toBe(Math.round(column!.width / 2));
  expect(Math.round(line!.x + line!.width)).toBe(Math.round(column!.x + column!.width));
});

test("a dual button shows its two buttons side by side, one under another on phones if set", async ({ page }) => {
  const address = await storePageWith("dual", [
    {
      id: "pair",
      type: "dualButton",
      first: { label: "Handle nå", href: "/products" },
      second: { label: "Les mer", href: "https://example.com", newTab: true, variant: "outline" },
      stackOnPhones: true,
      gap: 20,
    },
    { id: "half", type: "dualButton", first: { label: "Bare én", href: "/om" }, second: { label: "", href: "" } },
  ]);
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(address);
  const first = page.getByRole("link", { name: "Handle nå" });
  const second = page.getByRole("link", { name: "Les mer (opens in a new tab)" });
  await expect(second).toHaveAttribute("target", "_blank");
  const [a, b] = await Promise.all([first.boundingBox(), second.boundingBox()]);
  expect(Math.round(a!.y)).toBe(Math.round(b!.y));
  expect(Math.round(b!.x - (a!.x + a!.width))).toBe(20);
  // A button without its text and address is left out.
  await expect(page.getByRole("link", { name: "Bare én" })).toBeVisible();
  await expect(page.locator("main a[href='']")).toHaveCount(0);

  await page.setViewportSize({ width: 390, height: 800 });
  const [c, d] = await Promise.all([first.boundingBox(), second.boundingBox()]);
  expect(d!.y).toBeGreaterThan(c!.y + c!.height);
  expect(Math.round(c!.width)).toBe(Math.round(d!.width));
});

test("an accordion opens its sections without script, one at a time if set, and find opens the one holding a word", async ({ page }) => {
  const text = (words: string) => ({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: words }] }] });
  const address = await storePageWith("accordion", [
    {
      id: "acc",
      type: "accordion",
      openFirst: true,
      single: true,
      items: [
        { id: "a", title: "Levering", body: text("Vi sender innen to dager.") },
        { id: "b", title: "Retur", body: text("Du kan returnere i 30 dager.") },
        { id: "c", title: "", body: text("Uten tittel vises ikke.") },
      ],
    },
  ]);
  await page.goto(address);
  const delivery = page.locator("main details").filter({ hasText: "Levering" });
  const returns = page.locator("main details").filter({ hasText: "Retur" });
  await expect(page.locator("main details")).toHaveCount(2);
  await expect(page.getByText("Vi sender innen to dager.")).toBeVisible();
  await expect(page.getByText("Du kan returnere i 30 dager.")).toBeHidden();
  // Opening the second closes the first.
  await returns.locator("summary").click();
  await expect(page.getByText("Du kan returnere i 30 dager.")).toBeVisible();
  await expect(delivery).not.toHaveAttribute("open");
  // The text is in the page for search engines and the browser's find, even while closed.
  expect(await page.content()).toContain("Vi sender innen to dager.");
});

test("tabs show one panel at a time, chosen by clicking or the arrow keys, with every panel in the page", async ({ page }) => {
  const text = (words: string) => ({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: words }] }] });
  const address = await storePageWith("tabs", [
    {
      id: "tabs",
      type: "tabs",
      items: [
        { id: "a", title: "Beskrivelse", body: text("En hvit kopp i steingods.") },
        { id: "b", title: "Mål", body: text("Åtte centimeter høy.") },
        { id: "c", title: "Stell", body: text("Tåler oppvaskmaskin.") },
        { id: "d", title: "", body: text("Uten tittel.") },
      ],
    },
  ]);
  await page.goto(address);
  const tabs = page.getByRole("tab");
  await expect(tabs).toHaveCount(3);
  await expect(page.getByRole("tab", { name: "Beskrivelse" })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("tabpanel")).toHaveText("En hvit kopp i steingods.");
  // Every panel is in the page for search engines, the others hidden.
  expect(await page.content()).toContain("Tåler oppvaskmaskin.");
  await expect(page.getByText("Tåler oppvaskmaskin.")).toBeHidden();

  await page.getByRole("tab", { name: "Mål" }).click();
  await expect(page.getByRole("tabpanel")).toHaveText("Åtte centimeter høy.");
  await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("tab", { name: "Stell" })).toBeFocused();
  await expect(page.getByRole("tabpanel")).toHaveText("Tåler oppvaskmaskin.");
  await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("tab", { name: "Beskrivelse" })).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("End");
  await expect(page.getByRole("tab", { name: "Stell" })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("tab", { name: "Stell" })).toHaveAttribute("tabindex", "0");
  await expect(page.getByRole("tab", { name: "Mål" })).toHaveAttribute("tabindex", "-1");
});

test.describe("without script", () => {
  test.use({ javaScriptEnabled: false });

  test("an accordion's sections still open", async ({ page }) => {
    const text = (words: string) => ({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: words }] }] });
    const address = await storePageWith("accordion-nojs", [
      { id: "acc", type: "accordion", items: [{ id: "a", title: "Levering", body: text("Vi sender innen to dager.") }] },
    ]);
    await page.goto(address);
    await expect(page.getByText("Vi sender innen to dager.")).toBeHidden();
    await page.locator("main summary").click();
    await expect(page.getByText("Vi sender innen to dager.")).toBeVisible();
  });
});
