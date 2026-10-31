import { expect, test } from "@playwright/test";

/**
 * WCAG 2.2's minimum target size (2.5.8, PSI ACC-07): every link and button in a footer is at least 24 by 24 CSS pixels at a phone's
 * width, on Kaizena Flow's own site and a store's. A link inside a sentence is excepted by the criterion and not measured.
 */
test.use({ viewport: { width: 390, height: 844 } });

for (const path of ["/", "/sign-up", "/s/demo/no"]) {
  test(`footer targets are 24 px at least on ${path}`, async ({ page }) => {
    await page.goto(path);
    const small = await page.evaluate(() =>
      [...document.querySelectorAll("footer a, footer button")].flatMap((el) => {
        const box = el.getBoundingClientRect();
        if (box.width === 0 || box.height === 0) return [];
        const sentence = el.closest("p");
        if (sentence && (sentence.textContent ?? "").trim().length > (el.textContent ?? "").trim().length + 3) return [];
        return box.width < 24 || box.height < 24 ? [`${(el.textContent || el.getAttribute("aria-label") || "").trim()} ${Math.round(box.width)}x${Math.round(box.height)}`] : [];
      }),
    );
    expect(small).toEqual([]);
  });
}
