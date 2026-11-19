import "server-only";

import type { ExperimentsMessages } from "@/lib/admin-messages/experiments.en";
import { experimentCard, type ExperimentCard } from "@/lib/experiment-card";
import type { VariantFigures } from "@/lib/experiment-results";
import { groupOf, testIdeas, type ListGroup, type TestIdea } from "@/lib/experiment-list";
import type { Store } from "./stores";

import { buttonsOf, listExperiments, publishedContentOf, testablePages, type ExperimentInfo } from "./experiment-admin";
import { experimentResults } from "./experiment-results";
import { experimentTraffic } from "./experiment-traffic";

export type ListedTest = ExperimentInfo & { exposed: number; card: ExperimentCard; group: ListGroup; figures: VariantFigures[] | null };

/** How many testable targets the ideas look at, as `suggest_experiments` does. */
const IDEA_TARGETS = 24;

/** Every test of the store with its card and group; only a started test that is not decided counts results. */
export async function listedTests(store: Store, say: { words: ExperimentsMessages; numberLocale: string }, now = new Date()): Promise<ListedTest[]> {
  const tests = await listExperiments(store.id);
  return Promise.all(
    tests.map(async (t): Promise<ListedTest> => {
      const results = t.status === "running" || t.status === "stopped" ? await experimentResults(store, t, now, say) : null;
      const card = experimentCard({ status: t.status, goal: t.goal, minDays: t.minDays, minVisitors: t.minVisitors, results, now });
      return { ...t, card, group: groupOf(t.status, card), figures: results?.figures ?? null };
    }),
  );
}

/**
 * A store's tests, each with its card and group (D148 phase 15, `src/lib/experiment-list.ts`), and a few ideas to test from its own
 * traffic. Only a started test that is not decided counts results: a draft, a scheduled test and a decided one need none for the list.
 */
export async function experimentList(
  store: Store,
  say: { words: ExperimentsMessages; numberLocale: string },
  now = new Date(),
): Promise<{ tests: ListedTest[]; ideas: TestIdea[] }> {
  const [listed, targets] = await Promise.all([listedTests(store, say, now), testablePages(store.id)]);
  const busy = new Set(listed.filter((t) => t.status === "draft" || t.status === "scheduled" || t.status === "running").map((t) => t.page.id));
  const open = targets.filter((t) => !busy.has(t.id) && !t.partOnly).slice(0, IDEA_TARGETS);
  const [facts, withButtons] = await Promise.all([
    experimentTraffic(store, open, now),
    Promise.all(open.map(async (t) => ({ ...t, buttons: buttonsOf(await publishedContentOf(store.id, t.id)).map((b) => b.label) }))),
  ]);
  return { tests: listed, ideas: testIdeas({ targets: withButtons, facts, busy, words: say.words }) };
}
