import "server-only";

import { sql } from "drizzle-orm";

import { db } from "@/db/client";
import { targetLabel } from "@/lib/ab-site";
import { GOAL_WORDS, STATUS_WORDS } from "@/lib/experiments";
import type { PlatformToolInput } from "@/lib/manager-tools";
import { adviceFor } from "@/lib/platform-experiments";
import type { UnitTestRow } from "@/lib/platform-unit-tests";

import type { Account } from "./auth";
import { getExperiment } from "./experiment-admin";
import { explainResultsTool } from "./experiment-tools";
import { OwnerToolError } from "./owner-tool-error";
import { platformExperiments, type PlatformTest } from "./platform-experiments";
import { platformUnitTest, platformUnitTests } from "./platform-unit-tests";
import { getStore } from "./stores";

type Row = Record<string, unknown>;

/**
 * The platform AI manager's A/B test tools (D148, phase 8): Kaizen's team reads every store's tests and says what needs a look; they never
 * change one, as a store's owner decides what runs on their store. The figures, verdicts and flags are the platform's view's
 * (`platformExperiments()`, `platformUnitTests()`, `flagsOf()`) and the owner's own results (`explainResultsTool()`): nothing is
 * counted or judged here, and nothing is written.
 */

const fail = (message: string): never => {
  throw new OwnerToolError(message);
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const day = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);

const target = (t: PlatformTest) => `${targetLabel(t.target.type as Parameters<typeof targetLabel>[0], t.target.slug, t.target.title, t.target.role)}${t.target.part ? ", a part of it" : ""}`;

const testLine = (t: PlatformTest, now: Date) => ({
  id: t.id,
  store: t.store.slug,
  store_name: t.store.name,
  name: t.name,
  status: STATUS_WORDS[t.status],
  tests: target(t),
  improves: GOAL_WORDS[t.goal].label,
  versions: t.versions,
  started: day(t.startedAt),
  starts: t.status === "scheduled" ? day(t.scheduledStart) : undefined,
  days_running: t.startedAt && t.status === "running" ? Math.floor((now.getTime() - t.startedAt.getTime()) / 86_400_000) : undefined,
  visitors_counted: t.exposed,
  visitors_per_version: t.split ? t.split.map((s) => `${s.key.toUpperCase()}: ${s.visitors}`) : undefined,
  verdict: t.headline ?? undefined,
  stopped_by: t.status === "stopped" ? (t.stopReason === "guardrail" ? "the guardrail (a version was clearly selling less)" : t.stopReason === "planned_end" ? "its planned end" : "a person") : undefined,
  winner: t.status === "applied" ? (t.appliedVariant ? t.appliedVariant.toUpperCase() : "the original") : undefined,
  needs_a_look: t.flags.length > 0 ? t.flags.map((f) => f.words) : undefined,
});

const ownLine = (t: UnitTestRow) => ({
  id: t.id,
  what: t.name,
  store: t.store?.slug ?? "every store",
  counted: `${t.control.units} ${t.unit === "tab" ? "tabs" : "searches"} for ${t.control.name}, ${t.treatment.units} for ${t.treatment.name}`,
  verdict: t.headline,
  needs_a_look: t.flags.length > 0 ? t.flags.map((f) => f.words) : undefined,
});

/** Every store's tests, what needs a look first; filtered by store, by trouble or by whether they are still going. */
export async function listAbTests({ store, status, needs_attention, limit }: PlatformToolInput<"list_ab_tests">, now = new Date()) {
  let slug: string | null = null;
  if (store) {
    const found = await getStore(store);
    if (!found) return fail(`No store at ${store}.`);
    slug = found.slug;
  }
  const [all, own] = await Promise.all([platformExperiments(status === "all", now), platformUnitTests(now)]);
  const tests = all.tests.filter((t) => (!slug || t.store.slug === slug) && (!needs_attention || t.flags.length > 0));
  // The search test runs in every store, so a store's list has it too.
  const ownTests = own.filter((t) => (!slug || t.store === null || t.store.slug === slug) && (!needs_attention || t.flags.length > 0));
  return {
    overview: {
      running: all.overview.running,
      scheduled: all.overview.scheduled,
      stopped_waiting_for_a_decision: all.overview.stopped,
      need_a_look: all.overview.needAttention,
      stores_with_a_running_test: all.overview.stores,
    },
    tests: tests.slice(0, limit).map((t) => testLine(t, now)),
    shown: Math.min(tests.length, limit),
    of: tests.length,
    tests_that_run_on_their_own: ownTests.map(ownLine),
    note: all.truncated ? "Only the newest 300 tests are looked at." : "Read-only: you cannot start, stop or change a store's test. explain_ab_test gives one test's figures; tell the owner what needs a look.",
    admin: "/admin/platform/experiments",
  };
}

/**
 * One test in full: a store's page test (the owner's own results, with what to tell the owner instead of what to press), the search test, or
 * a store's recommendations held-out ranking, by the id `list_ab_tests` gave.
 */
export async function explainAbTest(account: Account, { test }: PlatformToolInput<"explain_ab_test">, now = new Date()) {
  const ref = test.trim();
  if (UUID.test(ref)) {
    const [row] = await db().execute<Row>(sql`
      select e.id, e.store_id, s.slug from commerce.experiments e join commerce.stores s on s.id = e.store_id where e.id = ${ref}::uuid
    `);
    if (row) {
      const store = await getStore(String(row.slug));
      const info = store ? await getExperiment(store.id, ref) : null;
      if (!store || !info) return fail(`The test ${ref} could not be read.`);
      if (info.status === "draft" || info.status === "scheduled") {
        return {
          store: store.slug,
          test: { id: info.id, name: info.name, status: STATUS_WORDS[info.status], tests: targetLabel(info.page.kind, info.page.slug, info.page.title, info.page.role), improves: GOAL_WORDS[info.goal].label },
          results: "None yet: the test has not started.",
          schedule_problem: info.scheduleProblem ?? undefined,
          what_next: adviceFor({ status: info.status, verdict: null, guardrail: false }),
          admin: "/admin/platform/experiments",
        };
      }
      // The owner's own account of it (the same figures and verdict), with the advice for the platform in place of the owner's.
      const owners = await explainResultsTool({ account, store, invalidate: () => {} }, { experiment: ref });
      const verdict = (owners as { verdict?: { kind: string } }).verdict?.kind ?? null;
      const best = info.variants.find((v) => v.key === (info.appliedVariant ?? ""))?.name ?? null;
      return {
        store: store.slug,
        ...owners,
        what_next: adviceFor({ status: info.status, verdict, guardrail: info.stopReason === "guardrail", version: best }),
        admin: "/admin/platform/experiments",
      };
    }
  }
  const own = await platformUnitTest(ref, now);
  if (own) {
    const { primary, secondary } = own;
    const words = primary.unit === "tab" ? "tabs" : "searches";
    return {
      test: ownLine(primary),
      status: primary.status === "running" ? "Running" : "Ended",
      verdict: { headline: primary.headline, detail: primary.detail },
      also: secondary ? { headline: secondary.headline, detail: secondary.detail } : undefined,
      how_it_is_counted: `${words[0].toUpperCase()}${words.slice(1)}, each counted once by an id nobody keeps: no cookie is set and nobody is identified. The arithmetic is the one a page test uses.`,
      what_next: [primary.call === "broken" ? "The split is off: the assignment or its log may be broken, so do not trust the figures." : "Nothing to do: it runs on its own and the figures only get clearer with more " + words + "."],
      admin: "/admin/platform/experiments",
    };
  }
  return fail(`No A/B test "${ref}". Use list_ab_tests for the ids.`);
}
