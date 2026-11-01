import Link from "next/link";

import { Card, Chip } from "@/components/admin/ui";
import { countWords, fillWords } from "@/lib/admin-fill";
import type { OrderMessages } from "@/lib/admin-messages/order.en";
import type { OrderProfit } from "@/lib/order-profit";

/**
 * What the order left the store, on its page (D415): one figure first, with its share of what the order brought in, and how it adds up one
 * step away. An order with an item without a cost price says so and links to where costs are entered, rather than show a figure that leaves
 * them out.
 */
export function ProfitCard({
  profit,
  money,
  percent,
  words: w,
  costsHref,
  settingsHref,
}: {
  profit: OrderProfit;
  money: (minor: number) => string;
  percent: (share: number) => string;
  words: OrderMessages["profit"];
  /** Where cost prices are entered: the products list. */
  costsHref: string;
  /** Where the store's estimates are changed (Analytics settings). */
  settingsHref: string;
}) {
  const p = profit.profitMinor;
  return (
    <Card title={w.title} compact aside={profit.estimated && p !== null ? <Chip>{w.estimated}</Chip> : undefined}>
      <div className="flex flex-col gap-3 text-sm" data-order-profit>
        {p !== null ? (
          <div className="flex flex-col gap-1">
            <p className={`text-body-strong ${p < 0 ? "text-danger-text" : "text-ink"}`}>{fillWords(p < 0 ? w.lost : w.made, { amount: money(Math.abs(p)) })}</p>
            {profit.margin !== null && <p className="text-muted">{fillWords(w.margin, { margin: percent(profit.margin) })}</p>}
          </div>
        ) : profit.linesWithoutCost > 0 ? (
          <p>
            {countWords(profit.linesWithoutCost, w.missingCost, { n: profit.linesWithoutCost })}{" "}
            <Link href={costsHref} className="underline">
              {w.addCosts}
            </Link>
          </p>
        ) : (
          <p>{w.noRate}</p>
        )}
        <details>
          <summary className="cursor-pointer select-none text-muted">{w.details}</summary>
          <dl className="mt-2 grid grid-cols-[1fr_auto] gap-x-4 gap-y-1">
            {profit.lines.map((line) => (
              <div key={line.key} className="contents">
                <dt className="text-muted">
                  {w.lines[line.key]}
                  {line.estimated && <span className="ml-1 text-xs">({w.estimatedMark})</span>}
                </dt>
                <dd className="text-right tabular-nums">{line.amountMinor === null ? w.notKnown : money(line.amountMinor)}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-2 text-xs text-muted">
            {w.beforeAds}{" "}
            <Link href={settingsHref} className="underline">
              {w.settings}
            </Link>
          </p>
        </details>
      </div>
    </Card>
  );
}
