import Link from "next/link";
import type { ReactNode } from "react";

import { formatMoney } from "@/lib/money";
import { formatDay } from "@/lib/work-dates";
import { formatDuration } from "@/lib/work-time";
import type { WorkAssignmentItem } from "@/server/work";

import { rateText } from "./client-detail";
import { EstimateProgress } from "./estimate-progress";
import { card } from "./work-parts";
import { workText } from "@/lib/work-text";
import { fillWords } from "@/lib/admin-fill";

function Row({ label, children }: { label: string; children: ReactNode }) {
  const tw = workText().assignmentDetail;
  return (
    <>
      <dt className="text-muted">{label}</dt>
      <dd className="min-w-0 [overflow-wrap:anywhere]">{children ?? <span className="text-muted">{tw.notSet}</span>}</dd>
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
  const tw = workText().assignmentDetail;
  const s = assignment.summary;
  const money = (minor: number) => formatMoney(minor, assignment.currency, locale);
  const period = [assignment.startDate, assignment.endDate].map((day) => (day ? formatDay(day, locale) : null));
  return (
    <section aria-labelledby="summary-heading" className={`${card} flex flex-col gap-4`}>
      <h2 id="summary-heading" className="text-title text-ink">
        {tw.progress}
      </h2>
      <EstimateProgress
        assignmentId={assignment.id}
        loggedMinutes={s.loggedMinutes}
        estimatedMinutes={s.estimatedMinutes}
        alertMinutes={assignment.estimateAlertMinutes}
      />
      <dl className="grid gap-x-6 gap-y-2 border-t border-line pt-4 text-sm sm:grid-cols-[11rem_1fr]">
        <Row label={tw.client}>
          <Link href={`${base}/clients/${assignment.clientId}`} className="underline">
            {assignment.clientName}
          </Link>
          {assignment.clientArchived && " (archived)"}
        </Row>
        <Row label={tw.billing}>
          {workText().labels.billingType[assignment.billingType]}, {rateText(assignment, locale)}
        </Row>
        <Row label={tw.billableTime}>{formatDuration(s.billableMinutes)}</Row>
        <Row label={tw.notInvoiced}>
          {s.unbilledMinutes > 0 || s.unbilledAmountMinor > 0
            ? `${formatDuration(s.unbilledMinutes)}, ${money(s.unbilledAmountMinor)} without VAT`
            : "Nothing"}
        </Row>
        <Row label={tw.period}>{period[0] || period[1] ? `${period[0] ?? "…"} to ${period[1] ?? "…"}` : null}</Row>
        <Row label={tw.estimateWarnings}>
          {assignment.estimateAlertMinutes === null
            ? tw.off
            : `${fillWords(tw.minutesBefore, { minutes: assignment.estimateAlertMinutes })}${
                [assignment.estimateAlertPopup && tw.aMessage, assignment.estimateAlertSound && tw.aChime].filter(
                  Boolean,
                ).length > 0
                  ? fillWords(tw.withWarnings, { what: [assignment.estimateAlertPopup && tw.aMessage, assignment.estimateAlertSound && tw.aChime].filter(Boolean).join(tw.and) })
                  : ""
              }`}
        </Row>
      </dl>
    </section>
  );
}
