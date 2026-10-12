import { expect, test } from "@playwright/test";

import { storePageWith } from "./db";

/** Components in an FAQ's answer (D208): drawn under the answer's text when the question opens, styled as their own. */

const doc = (text: string) => ({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] });

test("an answer shows its button and table under its text, and the FAQPage data has its words", async ({ page }) => {
  const url = await storePageWith("faq-deler", [
    {
      id: "faq1",
      type: "faq",
      items: [
        {
          id: "q1",
          title: "Hvordan bestiller jeg?",
          body: doc("Velg en tid i kalenderen."),
          blocks: [
            { id: "btn1", type: "button", label: "Bestill nå", href: "/bestill", style: { margin: { top: 24, right: 0, bottom: 0, left: 0 } } },
            { id: "tab1", type: "table", header: true, rows: [["Dag", "Åpent"], ["Mandag", "9–17"]] },
          ],
        },
        { id: "q2", title: "Bare knapp?", body: { type: "doc", content: [{ type: "paragraph" }] }, blocks: [{ id: "btn2", type: "button", label: "Se priser", href: "/priser" }] },
      ],
    },
  ]);
  await page.setViewportSize({ width: 1200, height: 900 });
  await page.goto(url);
  const button = page.getByRole("link", { name: "Bestill nå" });
  await expect(button).toBeHidden();
  await page.getByText("Hvordan bestiller jeg?").click();
  await expect(button).toBeVisible();
  await expect(button).toHaveAttribute("href", /\/bestill$/);
  await expect(page.getByRole("cell", { name: "Mandag" })).toBeVisible();
  // The button's own margin, from the part stylesheet.
  const gap = await page.evaluate(() => {
    const text = [...document.querySelectorAll("details p")].find((p) => p.textContent === "Velg en tid i kalenderen.")!;
    const box = document.querySelector(".kz-btn")!.getBoundingClientRect();
    return box.top - text.getBoundingClientRect().bottom;
  });
  expect(gap).toBeGreaterThanOrEqual(24);
  // A question with only a component shows.
  await page.getByText("Bare knapp?").click();
  await expect(page.getByRole("link", { name: "Se priser" })).toBeVisible();
  const faqData = (await page.locator('script[type="application/ld+json"]').allTextContents()).find((text) => text.includes('"FAQPage"')) ?? "";
  // Its words are in the FAQPage data; a question answered by a button alone has none to give and is left out of it.
  expect(faqData).toContain("Velg en tid i kalenderen.");
  expect(faqData).not.toContain("Bare knapp?");
});
