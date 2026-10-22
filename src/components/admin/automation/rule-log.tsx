import Link from "next/link";

import { Card, Chip } from "@/components/admin/ui";
import { fillWords } from "@/lib/admin-fill";
import { notificationsEn, type NotificationsMessages } from "@/lib/admin-messages/notifications.en";
import type { ConditionKind } from "@/lib/order-rules";
import type { RuleRun } from "@/server/order-rules";

/**
 * The automation log (wave 3, D238, `docs/wave-3-notifications.md` 2.5 point 3): the runs of the last twelve months, newest first: when, the order (a
 * link), the rule as it was named, whether it matched, and what each action did or why it could not. A table, because runs are compared down a column.
 */
export function RuleLog({
  runs,
  base,
  when,
  more,
  words = notificationsEn,
}: {
  runs: RuleRun[];
  base: string;
  when: (iso: string) => string;
  more: string | null;
  /** The admin's words in the account's language; English unless given. */
  words?: NotificationsMessages;
}) {
  const w = words.rules.logPage;
  const outcome = (why: string) => (w.outcomes as Record<string, string>)[why] ?? why;
  return (
    <Card title={w.runs}>
      {runs.length === 0 ? (
        <p className="text-body text-muted">{w.none}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[40rem] text-left text-sm">
            <caption className="sr-only">{w.caption}</caption>
            <thead>
              <tr className="border-b border-line">
                <th scope="col" className="py-2 pr-3 font-medium">{w.when}</th>
                <th scope="col" className="py-2 pr-3 font-medium">{w.order}</th>
                <th scope="col" className="py-2 pr-3 font-medium">{w.rule}</th>
                <th scope="col" className="py-2 pr-3 font-medium">{w.matched}</th>
                <th scope="col" className="py-2 font-medium">{w.did}</th>
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
                      <span className="text-muted">{w.notFound}</span>
                    )}
                  </td>
                  <td className="py-2 pr-3">
                    {run.ruleName}
                    <span className="block text-xs text-muted">{fillWords(w.version, { n: run.ruleVersion })}</span>
                  </td>
                  <td className="py-2 pr-3">
                    <Chip signal={run.matched ? "positive" : "neutral"}>{run.matched ? w.yes : w.no}</Chip>
                  </td>
                  <td className="py-2">
                    <ul className="flex flex-col gap-1">
                      {run.matched
                        ? run.outcome.actions.map((a, i) => (
                            <li key={i}>
                              {(w.actionWords as Record<string, string>)[a.kind] ?? a.kind}: {a.ok ? w.done : fillWords(w.notDone, { why: a.problem ? outcome(a.problem) : w.unknown })}
                            </li>
                          ))
                        : run.outcome.conditions
                            .filter((c) => !c.met)
                            .map((c, i) => (
                              <li key={i} className="text-muted">
                                {fillWords(w.notMet, { condition: words.rules.conditions[c.kind as ConditionKind] ?? c.kind })}
                                {c.why ? ` (${outcome(c.why)})` : ""}
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
            {w.older}
          </Link>
        </p>
      )}
    </Card>
  );
}
