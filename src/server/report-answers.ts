import "server-only";

import type { AdminLang } from "@/lib/admin-lang";
import { READY_KEYS, READY_REPORTS, type ReadyKey } from "@/lib/report-catalogue";
import type { Store } from "./stores";

import { log } from "./log";
import { reportLabels } from "./report-labels";
import { runReport } from "./report-query";

/** A ready report's answer for the last 30 days: its first row's name and that row's share of net sales (round 9, D630). */
export type ReadyAnswer = { label: string; share: number } | "none";

/**
 * Each ready report's answer on the Reports page (round 9, D630): the report's own cut, net sales only, the last 30 days, no comparison and
 * one row, so the page can say "Bordlampe, 41 % of sales" beside "By product". A report that cannot be read says nothing.
 */
export async function readyAnswers(store: Store, lang: AdminLang, locale: string, now = new Date()): Promise<Partial<Record<ReadyKey, ReadyAnswer>>> {
  const answers = await Promise.all(
    READY_KEYS.map(async (key): Promise<[ReadyKey, ReadyAnswer | null]> => {
      const base = READY_REPORTS[key];
      const spec = { ...base, metrics: ["net_sales" as const], period: { preset: "30d" as const, compare: "none" as const }, sort: "net_sales" as const, limit: 1, chart: "table" as const };
      try {
        const outcome = await runReport(store, spec, now);
        if (!outcome.ok) return [key, null];
        const total = outcome.report.totals.values.net_sales ?? 0;
        const top = outcome.report.rows.find((r) => !r.rest);
        if (!top || total <= 0) return [key, "none"];
        const labels = await reportLabels(store, outcome.report, lang, locale);
        const dimension = spec.dimensions[0];
        const value = top.keys[0];
        return [key, { label: labels.get(`${dimension}:${value}`) ?? value, share: Math.round(((top.values.net_sales ?? 0) / total) * 100) }];
      } catch (error) {
        log("warn", "reports.ready_answer_failed", { key }, error);
        return [key, null];
      }
    }),
  );
  return Object.fromEntries(answers.filter((a): a is [ReadyKey, ReadyAnswer] => a[1] !== null));
}
