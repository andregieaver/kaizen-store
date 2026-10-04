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

/** The serious and critical violations on the page as it is now, with where they are. */
export async function violationsOn(page: Page, options: { exclude?: string[] } = {}): Promise<Finding[]> {
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

/** The findings as lines a failing test prints. */
export const describeFindings = (findings: Finding[]): string[] =>
  findings.map((finding) => `${finding.impact} ${finding.rule}: ${finding.help} at ${finding.targets.join(" | ")}`);
