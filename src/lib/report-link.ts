import type { ReportSpec } from "./report-catalogue";

/**
 * A report's page as the AI manager hands it on (wave 8 unit B, D346): the builder's own address shape (`view?q=` with the spec), made by
 * the run_report tool, and read back from a tool's answer only in that shape, so the panel's *Save as report* never opens an address the
 * model wrote.
 */

export const reportLink = (storeSlug: string, spec: ReportSpec) =>
  `/admin/${storeSlug}/analytics/reports/view?${new URLSearchParams({ q: JSON.stringify(spec) }).toString()}`;

const SHAPE = /^\/admin\/[^/?#]+\/analytics\/reports\/view\?q=[^#]*$/;

/** The report page a run_report call's answer names, or nothing. */
export function reportOfResult(name: string, result: unknown): string | undefined {
  if (name !== "run_report" || !result || typeof result !== "object" || !("result" in result)) return undefined;
  const answer = (result as { result: unknown }).result;
  const link = answer && typeof answer === "object" ? (answer as { link?: unknown }).link : undefined;
  return typeof link === "string" && SHAPE.test(link) ? link : undefined;
}
