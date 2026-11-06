import Link from "next/link";

import { ButtonLink, Card, Chip } from "@/components/admin/ui";
import { countWords } from "@/lib/admin-fill";
import type { DealsMessages } from "@/lib/admin-messages/deals.en";
import type { DealStatus } from "@/lib/deals";

export type DealRow = { id: string; title: string; status: DealStatus; value: string | null };

const SIGNAL = { open: "neutral", won: "positive", lost: "danger" } as const;

/**
 * A person's or a company's deals (S2, D464), on their page: each with its status and value, the open ones counted, and New deal with
 * them already chosen for a member who may change customers.
 */
export function DealsCard({ deals, base, addHref, words, statuses }: { deals: DealRow[]; base: string; addHref: string | null; words: DealsMessages["card"]; statuses: DealsMessages["statuses"] }) {
  const open = deals.filter((d) => d.status === "open").length;
  return (
    <Card
      title={words.title}
      compact
      aside={addHref ? <ButtonLink href={addHref} size="dense">{words.add}</ButtonLink> : undefined}
    >
      {deals.length === 0 ? (
        <p className="text-sm text-muted">{words.none}</p>
      ) : (
        <div className="flex flex-col gap-2 text-sm">
          {open > 0 && <p className="text-muted">{countWords(open, words.open)}</p>}
          <ul className="flex flex-col divide-y divide-line">
            {deals.map((deal) => (
              <li key={deal.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <Link href={`${base}/deals/${deal.id}`} className="min-w-0 font-medium underline">
                  {deal.title}
                </Link>
                <span className="flex items-center gap-2">
                  {deal.value && <span className="text-ink-2">{deal.value}</span>}
                  <Chip signal={SIGNAL[deal.status]}>{statuses[deal.status]}</Chip>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  );
}
