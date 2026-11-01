import { expect, test } from "@playwright/test";

import { storePageWith } from "./db";

/** A timeline (D414): events along a line, alternating sides on a wide screen and along one side on a phone; an icon list's descriptions. */

const events = [
  { id: "a", date: "1998", title: "Founded in a garage", text: "Three shelves and a coffee machine." },
  { id: "b", date: "2010", title: "Our first shop", text: "" },
  { id: "c", date: "Spring 2024", title: "Online across Europe", text: "", icon: "globe" },
];

test("alternates sides on a wide screen, one side on a phone, as an ordered list", async ({ page }) => {
  const url = await storePageWith("tidslinje", [{ id: "tl", type: "timeline", items: events, layout: "alternate", htmlId: "tl" }]);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(url);
  const list = page.locator("#tl ol");
  await expect(list.getByRole("listitem")).toHaveCount(3);
  await expect(list.getByText("Spring 2024")).toBeVisible();
  const box = (await list.boundingBox())!;
  const middle = box.x + box.width / 2;
  const left = async (n: number) => (await list.getByRole("listitem").nth(n).boundingBox())!;
  // Wide: the first ends at the middle, the second starts there.
  expect((await left(0)).x + (await left(0)).width).toBeLessThanOrEqual(middle + 1);
  expect((await left(1)).x).toBeGreaterThanOrEqual(middle - 1);
  // A phone: all along one side.
  await page.setViewportSize({ width: 375, height: 900 });
  const xs = await list.getByRole("listitem").evaluateAll((items) => items.map((li) => Math.round(li.getBoundingClientRect().left)));
  expect(new Set(xs).size).toBe(1);
});

test("an icon list line shows its description under its words", async ({ page }) => {
  const url = await storePageWith("ikonliste-beskrivelse", [
    { id: "il", type: "iconList", htmlId: "il", items: [{ id: "l", icon: "check", text: "Fri frakt", href: "", description: "Over 500 kr, sendt samme dag." }] },
  ]);
  await page.goto(url);
  const line = page.locator("#il li").first();
  await expect(line.getByText("Fri frakt")).toBeVisible();
  const words = (await line.getByText("Fri frakt").boundingBox())!;
  const description = (await line.getByText("Over 500 kr, sendt samme dag.").boundingBox())!;
  expect(description.y).toBeGreaterThan(words.y);
});
