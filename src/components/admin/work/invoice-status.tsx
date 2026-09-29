import { statusView } from "@/lib/work-invoice-ui";
import type { InvoiceStatus } from "@/server/work-invoices";

import { Badge } from "./work-parts";

/**
 * An invoice's status as a chip: draft, issued, overdue, due soon, paid or void (docs/work.md 4.6). Overdue and due
 * soon are derived from the due date in the store's time zone (`today`), never stored. The words carry the meaning;
 * the colour only helps. `note` adds how late or how soon under the chip.
 */
export function InvoiceStatusChip({
  status,
  dueOn,
  today,
  showNote = false,
}: {
  status: InvoiceStatus;
  dueOn: string | null;
  today: string;
  showNote?: boolean;
}) {
  const view = statusView({ status, dueOn, today });
  return (
    <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1">
      <Badge tone={view.tone}>{view.label}</Badge>
      {showNote && view.note && <span className="text-xs text-muted">{view.note}</span>}
    </span>
  );
}
