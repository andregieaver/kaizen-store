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
