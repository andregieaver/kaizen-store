import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

import { FAILING_IMPACTS, WCAG_TAGS } from "../e2e/a11y";

/**
 * Published pages as visitors get them, in both colour modes (PSI 2026-10-30 ACC-01, ACC-09: the dark-mode regression of D390 shipped
 * because nothing scanned the live site after a change). axe's serious and critical findings fail the scan, with one class left out: the
 * contrast of text over a part's own picture, video or moving gradient (`[data-fx-bgroot]`), which axe cannot see and so measures against
 * the page behind it. Those are `pageIssues()`'s to check (D390), which reads the colours the part sets.
 */
const PAGES = ["/", "/pricing", "/themes", "/sign-up", "/status", "/report", "/no", "/no/pricing", "/s/demo/no", "/s/demo/no/p/demo-handlenett"];

for (const path of PAGES) {
  test(`no serious or critical finding on ${path}`, async ({ page }) => {
    // A product page streams its stock and keeps a connection open, so the page's load is waited for, then a moment for what streams in.
    const response = await page.goto(path, { waitUntil: "load" });
    await page.waitForTimeout(1500);
    expect(response?.status(), `${path} answered`).toBeLessThan(400);
    const { violations } = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
    const findings: string[] = [];
    for (const violation of violations.filter((v) => FAILING_IMPACTS.includes(v.impact ?? ""))) {
      for (const node of violation.nodes) {
        const selector = node.target.join(" ");
        if (violation.id === "color-contrast" && (await overOwnBackground(page, String(node.target[0])))) continue;
        findings.push(`${violation.impact} ${violation.id} at ${selector.slice(0, 120)}: ${node.failureSummary?.split("\n")[1]?.trim() ?? violation.help}`);
      }
    }
    expect(findings).toEqual([]);
  });
}

/**
 * Whether the text sits directly on a part that draws its own background (a picture, a video or a gradient layer): going up from the
 * text, that part comes before anything with a solid background colour. Text on a solid card inside such a part (the pricing cards) is
 * measured as axe measures it.
 */
async function overOwnBackground(page: import("@playwright/test").Page, selector: string): Promise<boolean> {
  return page.evaluate((target) => {
    const solid = (element: Element) => {
      const match = getComputedStyle(element).backgroundColor.match(/rgba?\(([^)]+)\)/);
      const alpha = match ? Number(match[1].split(",")[3] ?? 1) : 0;
      return alpha >= 1;
    };
    let element = document.querySelector(target);
    while (element) {
      if (element.querySelector(":scope > [data-fx-bgroot]")) return true;
      if (solid(element)) return false;
      element = element.parentElement;
    }
    return false;
  }, selector);
}
