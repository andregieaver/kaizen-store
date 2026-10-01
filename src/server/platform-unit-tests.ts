import "server-only";

import { sql } from "drizzle-orm";

import { readDb } from "@/db/client";
import { unitTestRow, type UnitTestRow } from "@/lib/platform-unit-tests";

import { recommendationReport } from "./recommend-events";
import { experimentResults, listExperiments } from "./search-experiment";

type Row = Record<string, unknown>;

/** Recommendation reports are read for this many stores at a time. */
const BATCH = 4;
/** The days of tabs a store's held-out comparison looks at, as its own report does by default. */
const RECOMMEND_DAYS = 30;
/** A search test that ended longer ago than this is no longer news. */
const RECENT_DAYS = 30;

/**
 * The tests that run on their own (D148, phase 7), for the platform's view: the search test (D77; every store takes part while it runs) and
 * every store's recommendations held-out ranking (D139, D140), each read in the engine's words (`unitTestRow()`). Read-only; never throws.
 */
export async function platformUnitTests(now = new Date()): Promise<UnitTestRow[]> {
  const rows: UnitTestRow[] = [];
  try {
    const tests = await listExperiments();
    const test = tests.find((t) => t.endedAt === null) ?? tests.find((t) => t.endedAt && now.getTime() - new Date(t.endedAt).getTime() < RECENT_DAYS * 86_400_000);
    if (test) {
      const results = await experimentResults(test);
      const { keyword, hybrid } = results.arms;
      rows.push(
        unitTestRow(
          {
            id: test.id,
            kind: "search",
            store: null,
            name: "Search: keyword or hybrid",
            status: test.endedAt === null ? "running" : "stopped",
            startedAt: new Date(test.startedAt),
            unit: "search",
            control: { name: "Keyword search", units: keyword.searches },
            treatment: { name: "Hybrid search", units: hybrid.searches },
            measure: "with results opened a result",
            controlRate: { hits: keyword.opened, of: keyword.withResults },
            treatmentRate: { hits: hybrid.opened, of: hybrid.withResults },
            rule: "interval",
            controlShare: test.keywordShare,
          },
          now,
        ),
      );
    }
  } catch (error) {
    console.error("[experiments] the platform view could not read the search test", error);
  }
  try {
    const stores = await readDb().execute<Row>(sql`
      select s.id, s.slug, s.name, r.holdout_percent
      from commerce.recommendation_settings r join commerce.stores s on s.id = r.store_id
      where r.enabled and r.holdout_percent > 0 and s.status <> 'closed' and not s.is_template
      order by lower(s.name)
    `);
    for (let i = 0; i < stores.length; i += BATCH) {
      const made = await Promise.all(
        stores.slice(i, i + BATCH).map(async (store): Promise<UnitTestRow | null> => {
          try {
            const report = await recommendationReport(String(store.id), RECOMMEND_DAYS);
            const ai = report.arms.find((a) => a.arm === "ai");
            const plain = report.arms.find((a) => a.arm === "baseline");
            if (!ai || !plain || ai.visitors + plain.visitors === 0) return null;
            return unitTestRow(
              {
                id: `recommendations:${String(store.id)}`,
                kind: "recommendations",
                store: { slug: String(store.slug), name: String(store.name) },
                name: "Recommendations: the AI's order or the plain one",
                status: "running",
                startedAt: null,
                unit: "tab",
                control: { name: "The plain order", units: plain.visitors },
                treatment: { name: "The AI's order", units: ai.visitors },
                measure: "clicked a recommendation",
                controlRate: { hits: plain.clickers, of: plain.visitors },
                treatmentRate: { hits: ai.clickers, of: ai.visitors },
                rule: "pooled",
                controlShare: Number(store.holdout_percent) / 100,
              },
              now,
            );
          } catch (error) {
            console.error("[experiments] the platform view could not read a store's recommendations", String(store.id), error);
            return null;
          }
        }),
      );
      rows.push(...made.filter((r): r is UnitTestRow => r !== null));
    }
  } catch (error) {
    console.error("[experiments] the platform view could not read the recommendations tests", error);
  }
  return rows;
}
