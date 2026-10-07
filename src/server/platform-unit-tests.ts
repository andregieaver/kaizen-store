import "server-only";

import { sql } from "drizzle-orm";

import { readDb } from "@/db/client";
import { unitTestRow, type UnitTestInput, type UnitTestRow } from "@/lib/platform-unit-tests";

import { recommendationReport } from "./recommend-events";
import { experimentResults, listExperiments } from "./search-experiment";

type Row = Record<string, unknown>;

/** Recommendation reports are read for this many stores at a time. */
const BATCH = 4;
/** The days of tabs a store's held-out comparison looks at, as its own report does by default. */
const RECOMMEND_DAYS = 30;
/** A search test that ended longer ago than this is no longer news. */
const RECENT_DAYS = 30;

/** One test as it is read: the measure it is judged on, and a second one worth saying beside it. */
type Measured = { primary: UnitTestInput; secondary: UnitTestInput | null };

async function searchTest(now: Date): Promise<Measured | null> {
  const tests = await listExperiments();
  const test = tests.find((t) => t.endedAt === null) ?? tests.find((t) => t.endedAt && now.getTime() - new Date(t.endedAt).getTime() < RECENT_DAYS * 86_400_000);
  if (!test) return null;
  const results = await experimentResults(test);
  const { keyword, hybrid } = results.arms;
  const common = {
    id: test.id,
    kind: "search" as const,
    store: null,
    name: "Search: keyword or hybrid",
    status: test.endedAt === null ? ("running" as const) : ("stopped" as const),
    startedAt: new Date(test.startedAt),
    unit: "search" as const,
    control: { name: "Keyword search", units: keyword.searches },
    treatment: { name: "Hybrid search", units: hybrid.searches },
    rule: "interval" as const,
    controlShare: test.keywordShare,
  };
  return {
    primary: { ...common, measure: "with results opened a result", controlRate: { hits: keyword.opened, of: keyword.withResults }, treatmentRate: { hits: hybrid.opened, of: hybrid.withResults } },
    // Fewer searches finding nothing is better.
    secondary: { ...common, measure: "found nothing", controlRate: { hits: keyword.zero, of: keyword.searches }, treatmentRate: { hits: hybrid.zero, of: hybrid.searches }, lowerIsBetter: true },
  };
}

async function recommendationTests(onlyStore?: string): Promise<Measured[]> {
  const stores = await readDb().execute<Row>(sql`
    select s.id, s.slug, s.name, r.holdout_percent
    from commerce.recommendation_settings r join commerce.stores s on s.id = r.store_id
    where r.enabled and r.holdout_percent > 0 and s.status <> 'closed' and not (s.is_template or s.starter)
      ${onlyStore ? sql`and s.id = ${onlyStore}::uuid` : sql``}
    order by lower(s.name)
  `);
  const out: Measured[] = [];
  for (let i = 0; i < stores.length; i += BATCH) {
    const made = await Promise.all(
      stores.slice(i, i + BATCH).map(async (store): Promise<Measured | null> => {
        try {
          const report = await recommendationReport(String(store.id), RECOMMEND_DAYS);
          const ai = report.arms.find((a) => a.arm === "ai");
          const plain = report.arms.find((a) => a.arm === "baseline");
          if (!ai || !plain || ai.visitors + plain.visitors === 0) return null;
          const common = {
            id: `recommendations:${String(store.id)}`,
            kind: "recommendations" as const,
            store: { slug: String(store.slug), name: String(store.name) },
            name: "Recommendations: the AI's order or the plain one",
            status: "running" as const,
            startedAt: null,
            unit: "tab" as const,
            control: { name: "The plain order", units: plain.visitors },
            treatment: { name: "The AI's order", units: ai.visitors },
            rule: "pooled" as const,
            controlShare: Number(store.holdout_percent) / 100,
          };
          return {
            primary: { ...common, measure: "clicked a recommendation", controlRate: { hits: plain.clickers, of: plain.visitors }, treatmentRate: { hits: ai.clickers, of: ai.visitors } },
            secondary: { ...common, measure: "put a recommended product in the cart", controlRate: { hits: plain.adders, of: plain.visitors }, treatmentRate: { hits: ai.adders, of: ai.visitors } },
          };
        } catch (error) {
          console.error("[experiments] the platform view could not read a store's recommendations", String(store.id), error);
          return null;
        }
      }),
    );
    out.push(...made.filter((m): m is Measured => m !== null));
  }
  return out;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const RECOMMENDATIONS = "recommendations:";

/** Every test that runs on its own, or only the one with this id (the search test's, or `recommendations:{store}`). */
async function measured(now: Date, id?: string): Promise<Measured[]> {
  const found: Measured[] = [];
  const recommendationStore = id?.startsWith(RECOMMENDATIONS) ? id.slice(RECOMMENDATIONS.length) : null;
  if (id && recommendationStore !== null && !UUID.test(recommendationStore)) return [];
  if (!id || recommendationStore === null) {
    try {
      const search = await searchTest(now);
      if (search) found.push(search);
    } catch (error) {
      console.error("[experiments] the platform view could not read the search test", error);
    }
  }
  if (!id || recommendationStore !== null) {
    try {
      found.push(...(await recommendationTests(recommendationStore ?? undefined)));
    } catch (error) {
      console.error("[experiments] the platform view could not read the recommendations tests", error);
    }
  }
  return found;
}

/**
 * The tests that run on their own (D148, phase 7), for the platform's view: the search test (D77; every store takes part while it runs) and
 * every store's recommendations held-out ranking (D139, D140), each read in the engine's words (`unitTestRow()`). Read-only; never throws.
 */
export async function platformUnitTests(now = new Date()): Promise<UnitTestRow[]> {
  return (await measured(now)).map((m) => unitTestRow(m.primary, now));
}

/**
 * One of those tests by its id (from `platformUnitTests()`), with the second measure beside the first: whether searches found nothing,
 * or whether tabs put a recommended product in the cart. Null when there is no such test now.
 */
export async function platformUnitTest(id: string, now = new Date()): Promise<{ primary: UnitTestRow; secondary: UnitTestRow | null } | null> {
  const found = (await measured(now, id)).find((m) => m.primary.id === id);
  return found ? { primary: unitTestRow(found.primary, now), secondary: found.secondary ? unitTestRow(found.secondary, now) : null } : null;
}
