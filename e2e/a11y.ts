import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";

/**
 * The accessibility scan (wave 1, 1e, docs/wave-1-trust.md 4.3, 6.1): axe-core over a page, with WCAG 2.0 A and AA, 2.1 A and AA and 2.2 AA
 * (the standard Kaizen builds to, decision D11), failing on serious and critical findings. An automated scan finds only part of the
 * problems (a person with a screen reader finds the rest), and what it passes is not a statement of conformance.
 */
export const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

/** What fails the build: the impacts axe calls serious and critical. */
export const FAILING_IMPACTS = ["serious", "critical"];

export type Finding = { rule: string; impact: string; help: string; targets: string[] };

/** Until no finite animation or transition runs on the page (a spinner's infinite one is left), for five seconds at most. */
async function settled(page: Page): Promise<void> {
  await page
    .waitForFunction(
      () => document.getAnimations().every((a) => a.playState !== "running" || a.effect?.getComputedTiming().iterations === Infinity),
      undefined,
      { timeout: 5_000, polling: 100 },
    )
    .catch(() => {});
}

async function scan(page: Page, options: { exclude?: string[] }): Promise<Finding[]> {
  let builder = new AxeBuilder({ page }).withTags(WCAG_TAGS);
  for (const selector of options.exclude ?? []) builder = builder.exclude(selector);
  const { violations } = await builder.analyze();
  return violations
    .filter((violation) => FAILING_IMPACTS.includes(violation.impact ?? ""))
    .map((violation) => ({
      rule: violation.id,
      impact: String(violation.impact),
      help: violation.help,
      targets: violation.nodes.slice(0, 4).map((node) => node.target.join(" ")),
    }));
}

/**
 * The serious and critical violations on the page as it is now, with where they are. Colours are measured at rest: the admin eases each
 * page in (`admin-enter`, opacity from 0 over 0.2 s, and again for a part that streams in later) and its links ease their colours, and
 * text read halfway through is a contrast finding that is not there (CI run 1212). So the scan waits for the page to settle, and a page
 * with findings is settled and scanned once more: what is wrong at rest is found both times, and only the second scan's findings count.
 */
export async function violationsOn(page: Page, options: { exclude?: string[] } = {}): Promise<Finding[]> {
  await settled(page);
  const first = await scan(page, options);
  if (first.length === 0) return first;
  await page.waitForLoadState("networkidle").catch(() => {});
  await settled(page);
  return scan(page, options);
}

/** The findings as lines a failing test prints. */
export const describeFindings = (findings: Finding[]): string[] =>
  findings.map((finding) => `${finding.impact} ${finding.rule}: ${finding.help} at ${finding.targets.join(" | ")}`);
