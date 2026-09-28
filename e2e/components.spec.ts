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
