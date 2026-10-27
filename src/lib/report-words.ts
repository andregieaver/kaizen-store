import type { CustomReportsMessages } from "./admin-messages/custom-reports.en";
import { fillWords } from "./admin-fill";
import { isMetric, type SpecProblem } from "./report-catalogue";

/**
 * Why a report cannot run, in the admin's words (wave 8 unit A, D345): one sentence per `specProblems()` finding, naming the figure or the
 * cut it is about. The builder shows them, saving refuses with them, and the AI manager's tools (unit B) repeat them.
 */
export function problemText(problem: SpecProblem, words: Pick<CustomReportsMessages, "problems" | "catalogue">): string {
  const name = (key: string) => (isMetric(key) ? words.catalogue.metrics[key] : (words.catalogue.dimensions as Record<string, string>)[key] ?? key);
  switch (problem.kind) {
    case "repeated":
      return fillWords(words.problems.repeated, { name: name(problem.key) });
    case "not_by_line":
      return fillWords(words.problems.not_by_line, { metric: name(problem.metric), dimension: name(problem.dimension).toLowerCase() });
    case "refunds_by":
      return fillWords(words.problems.refunds_by, { dimension: name(problem.dimension).toLowerCase() });
    case "empty_filter":
      return fillWords(words.problems.empty_filter, { dimension: name(problem.dimension).toLowerCase() });
    default:
      return words.problems[problem.kind];
  }
}
