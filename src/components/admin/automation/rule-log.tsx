import Link from "next/link";

import { Card, Chip } from "@/components/admin/ui";
import { OUTCOME_WORDS, type ActionKind, type ConditionKind } from "@/lib/order-rules";
import type { RuleRun } from "@/server/order-rules";

import { CONDITION_LABELS } from "./rule-labels";

const ACTION_WORDS: Record<ActionKind, string> = { tag: "Tag", notify: "Notify staff", hold: "Hold" };

/**
 * The automation log (wave 3, D238, `docs/wave-3-notifications.md` 2.5 point 3): the runs of the last twelve months, newest first: when, the order (a
 * link), the rule as it was named, whether it matched, and what each action did or why it could not. A table, because runs are compared down a column.
 */
export function RuleLog({ runs, base, when, more }: { runs: RuleRun[]; base: string; when: (iso: string) => string; more: string | null }) {
  return (
    <Card title="Runs">
      {runs.length === 0 ? (
        <p className="text-body text-muted">No runs in the last twelve months with these filters.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[40rem] text-left text-sm">
            <caption className="sr-only">Automation runs, newest first</caption>
            <thead>
              <tr className="border-b border-line">
                <th scope="col" className="py-2 pr-3 font-medium">When</th>
                <th scope="col" className="py-2 pr-3 font-medium">Order</th>
                <th scope="col" className="py-2 pr-3 font-medium">Rule</th>
                <th scope="col" className="py-2 pr-3 font-medium">Matched</th>
                <th scope="col" className="py-2 font-medium">What it did</th>
              </tr>
            </thead>
            <tbody>
              {runs.map((run) => (
                <tr key={run.id} className="border-b border-line align-top">
                  <td className="py-2 pr-3 whitespace-nowrap">{when(run.at)}</td>
                  <td className="py-2 pr-3">
                    {run.orderNumber ? (
                      <Link href={`${base}/orders/${run.orderId}`} className="underline underline-offset-2">
                        #{run.orderNumber}
                      </Link>
                    ) : (
                      <span className="text-muted">Not found</span>
                    )}
                  </td>
                  <td className="py-2 pr-3">
                    {run.ruleName}
                    <span className="block text-xs text-muted">version {run.ruleVersion}</span>
                  </td>
                  <td className="py-2 pr-3">
                    <Chip signal={run.matched ? "positive" : "neutral"}>{run.matched ? "Yes" : "No"}</Chip>
                  </td>
                  <td className="py-2">
                    <ul className="flex flex-col gap-1">
                      {run.matched
                        ? run.outcome.actions.map((a, i) => (
                            <li key={i}>
                              {ACTION_WORDS[a.kind] ?? a.kind}: {a.ok ? "done" : `not done (${a.problem ? OUTCOME_WORDS[a.problem] : "unknown"})`}
                            </li>
                          ))
                        : run.outcome.conditions
                            .filter((c) => !c.met)
                            .map((c, i) => (
                              <li key={i} className="text-muted">
                                Not met: {CONDITION_LABELS[c.kind as ConditionKind] ?? c.kind}
                                {c.why ? ` (${OUTCOME_WORDS[c.why]})` : ""}
                              </li>
                            ))}
                    </ul>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {more && (
        <p className="mt-4 text-sm">
          <Link href={more} className="underline underline-offset-2">
            Older runs
          </Link>
        </p>
      )}
    </Card>
  );
}
