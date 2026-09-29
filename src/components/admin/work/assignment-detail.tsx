import Link from "next/link";
import type { ReactNode } from "react";

import { formatMoney } from "@/lib/money";
import { formatDay } from "@/lib/work-dates";
import { formatDuration } from "@/lib/work-time";
import { BILLING_TYPE_LABELS } from "@/lib/work-ui";
import type { WorkAssignmentItem } from "@/server/work";

import { rateText } from "./client-detail";
import { EstimateProgress } from "./estimate-progress";
import { card } from "./work-parts";

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <dt className="text-muted">{label}</dt>
      <dd className="min-w-0 [overflow-wrap:anywhere]">{children ?? <span className="text-muted">Not set</span>}</dd>
    </>
  );
}

/**
 * The assignment at a glance: logged time against the estimate (live while the
 * timer runs), how it is billed, and what is not yet on an invoice. The
 * figures are worked out in code from the entries (`summariseAssignment`).
 */
export function AssignmentSummaryCard({
  assignment,
  base,
  locale,
}: {
  assignment: WorkAssignmentItem;
  base: string;
  locale: string;
}) {
  const s = assignment.summary;
  const money = (minor: number) => formatMoney(minor, assignment.currency, locale);
  const period = [assignment.startDate, assignment.endDate].map((day) => (day ? formatDay(day, locale) : null));
  return (
    <section aria-labelledby="summary-heading" className={`${card} flex flex-col gap-4`}>
      <h2 id="summary-heading" className="font-medium">
        Progress
      </h2>
      <EstimateProgress
        assignmentId={assignment.id}
        loggedMinutes={s.loggedMinutes}
        estimatedMinutes={s.estimatedMinutes}
        alertMinutes={assignment.estimateAlertMinutes}
      />
      <dl className="grid gap-x-6 gap-y-2 border-t border-border pt-4 text-sm sm:grid-cols-[11rem_1fr]">
        <Row label="Client">
          <Link href={`${base}/clients/${assignment.clientId}`} className="underline">
            {assignment.clientName}
          </Link>
          {assignment.clientArchived && " (archived)"}
        </Row>
        <Row label="Billing">
          {BILLING_TYPE_LABELS[assignment.billingType]}, {rateText(assignment, locale)}
        </Row>
        <Row label="Billable time">{formatDuration(s.billableMinutes)}</Row>
        <Row label="Not invoiced">
          {s.unbilledMinutes > 0 || s.unbilledAmountMinor > 0
            ? `${formatDuration(s.unbilledMinutes)}, ${money(s.unbilledAmountMinor)} without VAT`
            : "Nothing"}
        </Row>
        <Row label="Period">{period[0] || period[1] ? `${period[0] ?? "…"} to ${period[1] ?? "…"}` : null}</Row>
        <Row label="Estimate warnings">
          {assignment.estimateAlertMinutes === null
            ? "Off"
            : `${assignment.estimateAlertMinutes} minutes before${
                [assignment.estimateAlertPopup && "a message", assignment.estimateAlertSound && "a chime"].filter(
                  Boolean,
                ).length > 0
                  ? `, with ${[assignment.estimateAlertPopup && "a message", assignment.estimateAlertSound && "a chime"].filter(Boolean).join(" and ")}`
                  : ""
              }`}
        </Row>
      </dl>
    </section>
  );
}
