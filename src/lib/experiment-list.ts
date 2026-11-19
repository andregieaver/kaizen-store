import type { TargetKind } from "./ab-site";
import type { Signal } from "./admin-schemes";
import type { CardState, ExperimentCard } from "./experiment-card";
import { eligiblePerDay, findableChange, recommendedGoal, weeksOf, type TrafficFacts } from "./experiment-traffic";
import type { ExperimentStatus, Goal } from "./experiments";
import type { ExperimentsMessages } from "./admin-messages/experiments.en";

/**
 * The list of a store's A/B tests as a person reads it (D148 phase 15, `docs/ab-testing-usability.md` step 4): grouped by what each asks of
 * the owner, with one lead sentence on top, and a few ideas to test built from the store's own traffic in code, without a model call. Pure,
 * so the store's list, the Marketing page and the platform's view group and say it the same way.
 */

/** The colour of each stage's chip, on the test's page and in the list. */
export const STATE_SIGNAL: Record<CardState, Signal> = {
  draft: "neutral",
  scheduled: "insight",
  learning: "warning",
  answer: "positive",
  broken: "danger",
  applied: "positive",
  discarded: "neutral",
};

/** What a test asks of the owner now: a decision, patience, a start, or nothing. */
export type ListGroup = "decide" | "learning" | "planned" | "done";

export const LIST_GROUPS: readonly ListGroup[] = ["decide", "learning", "planned", "done"];

/** The group of a test from its status and its card (`experimentCard()`). */
export function groupOf(status: ExperimentStatus, card: Pick<ExperimentCard, "state">): ListGroup {
  if (status === "draft" || status === "scheduled") return "planned";
  if (status === "applied" || status === "discarded") return "done";
  // A stopped test waits for the owner's choice whatever it found; a running one only once it has an answer, or its split is broken.
  if (status === "stopped") return "decide";
  return card.state === "answer" || card.state === "broken" ? "decide" : "learning";
}

/** The sentence on top of the list, in the order a person needs it: what waits for them first. */
export type ListLead =
  | { kind: "decide"; n: number }
  | { kind: "learning"; n: number; readyAround: string | null }
  | { kind: "planned"; n: number }
  | { kind: "done" }
  | { kind: "none" };

export function listLead(rows: readonly { group: ListGroup; card: Pick<ExperimentCard, "progress"> }[]): ListLead {
  const count = (g: ListGroup) => rows.filter((r) => r.group === g).length;
  if (count("decide") > 0) return { kind: "decide", n: count("decide") };
  if (count("learning") > 0) {
    // The first of the learning tests likely to be ready, at today's pace.
    const days = rows
      .filter((r) => r.group === "learning" && r.card.progress.readyAround)
      .map((r) => r.card.progress.readyAround as string)
      .sort();
    return { kind: "learning", n: count("learning"), readyAround: days[0] ?? null };
  }
  if (count("planned") > 0) return { kind: "planned", n: count("planned") };
  return rows.length > 0 ? { kind: "done" } : { kind: "none" };
}

/** What an idea suggests changing: one thing, named for what the owner sees. */
export type IdeaChange = "button" | "heading" | "layout" | "header";

export type TestIdea = {
  targetId: string;
  slug: string;
  title: string;
  kind: TargetKind;
  role: string | null;
  change: IdeaChange;
  /** The words of the page's first button, for "Try other words on {button}". */
  button: string | null;
  /** The goal to start from (`recommendedGoal()`). */
  goal: Goal;
  /** How many could take part a day, and the weeks and the change a test could find at that pace; null when nothing is counted. */
  perDay: number | null;
  weeks: number | null;
  findable: number | null;
};

export type IdeaTarget = { id: string; slug: string; title: string; kind: TargetKind; role?: string | null; partOnly?: boolean; buttons: readonly string[] };

/** How many ideas the list shows. */
export const IDEAS_SHOWN = 3;

/**
 * A few ideas to test, from what can be tested and the store's own traffic: the pages most visitors could take part on first, each with one
 * change to try and how soon it would answer. A page already in a test (a draft, scheduled or running) is left out, and so is a footer, which
 * few visitors look at, and a working page, which is tested by a part only and begins in the builder.
 */
export function testIdeas(input: { targets: readonly IdeaTarget[]; facts: TrafficFacts; busy: ReadonlySet<string>; limit?: number; words: ExperimentsMessages }): TestIdea[] {
  const ideas = input.targets
    .filter((t) => !input.busy.has(t.id) && !t.partOnly && t.kind !== "footer")
    .map((t, index): TestIdea & { index: number } => {
      const goal = recommendedGoal(input.facts, t.id, input.words);
      const perDay = eligiblePerDay(input.facts, t.id);
      const found = findableChange({ facts: input.facts, targetId: t.id, goal, trafficShare: 1, versions: 2, words: input.words });
      const button = t.buttons[0] ?? null;
      const change: IdeaChange = t.kind === "layout" ? "layout" : t.kind === "header" ? "header" : button ? "button" : "heading";
      return {
        targetId: t.id,
        slug: t.slug,
        title: t.title,
        kind: t.kind,
        role: t.role ?? null,
        change,
        button: change === "button" ? button : null,
        goal,
        perDay: perDay === null ? null : Math.round(perDay * 10) / 10,
        weeks: found ? Math.max(1, weeksOf(found.estimate)) : null,
        findable: found?.change ?? null,
        index,
      };
    });
  // Most visitors first; without counted traffic, the front page first and then the order the store lists them in.
  const rank = (i: TestIdea & { index: number }) => [i.perDay === null ? 1 : 0, -(i.perDay ?? 0), i.role === "front" ? 0 : 1, i.index];
  ideas.sort((a, b) => {
    const [x, y] = [rank(a), rank(b)];
    for (let k = 0; k < x.length; k++) if (x[k] !== y[k]) return x[k] - y[k];
    return 0;
  });
  return ideas.slice(0, input.limit ?? IDEAS_SHOWN).map(({ index, ...idea }) => (void index, idea));
}
