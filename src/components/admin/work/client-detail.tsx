import Link from "next/link";
import type { ReactNode } from "react";

import { Stat, StatGrid } from "@/components/admin/overview-parts";
import { formatMoney } from "@/lib/money";
import { addressText } from "@/lib/work-input";
import { documentLanguage } from "@/lib/work-invoice-text";
import { VAT_TREATMENT_LABELS } from "@/lib/work-vat";
import { formatDuration } from "@/lib/work-time";
import { STAGE_STYLES, progressView } from "@/lib/work-ui";
import type { WorkAssignmentItem, WorkClientItem } from "@/server/work";

import { Badge, card } from "./work-parts";
import { CARD_CLASS } from "@/components/admin/ui";
import { workText } from "@/lib/work-text";
import { fillWords } from "@/lib/admin-fill";

const th = "px-4 py-2 text-left text-eyebrow text-muted uppercase";

const LANGUAGE_NAMES = { nb: "Norwegian", sv: "Swedish", da: "Danish", en: "English" } as const;

function Row({ label, children }: { label: string; children: ReactNode }) {
  const tw = workText().clientDetail;
  return (
    <>
      <dt className="text-muted">{label}</dt>
      <dd className="min-w-0 [overflow-wrap:anywhere]">{children ?? <span className="text-muted">{tw.notSet}</span>}</dd>
    </>
  );
}

const STATUS_TONE = { active: "good", paused: "warn", done: "neutral" } as const;

/** The rate an assignment is billed at, in words. */
export function rateText(assignment: WorkAssignmentItem, locale: string): string {
  const tw = workText().clientDetail;
  if (assignment.billingType === "fixed_fee") {
    return assignment.fixedAmountMinor === null
      ? tw.fixedFee
      : `${formatMoney(assignment.fixedAmountMinor, assignment.currency, locale)} fixed`;
  }
  const { rateMinor, rateSource } = assignment.summary;
  if (rateSource === "none") return tw.noRate;
  return `${formatMoney(rateMinor, assignment.currency, locale)} / h${rateSource === "client" ? " (client's rate)" : ""}`;
}

/** The client's details, as they are billed and printed. */
export function ClientDetails({
  client,
  locale,
  paymentDaysDefault,
}: {
  client: WorkClientItem;
  locale: string;
  paymentDaysDefault: number;
}) {
  const tw = workText().clientDetail;
  const address = addressText(client.billingAddress);
  return (
    <section aria-labelledby="client-details-heading" className={card}>
      <h2 id="client-details-heading" className="mb-3 text-title text-ink">
        {tw.details}
      </h2>
      <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-[11rem_1fr]">
        <Row label={tw.legalName}>{client.legalName}</Row>
        <Row label={tw.organisationNumber}>{client.organisationNumber}</Row>
        <Row label={tw.vatNumber}>{client.vatNumber}</Row>
        <Row label={tw.address}>{address || null}</Row>
        <Row label={tw.country}>{client.country}</Row>
        <Row label={tw.contact}>{[client.contactName, client.phone].filter(Boolean).join(", ") || null}</Row>
        <Row label={tw.invoiceEmail}>{client.billingEmail}</Row>
        <Row label={tw.currency}>{client.currency}</Row>
        <Row label={tw.hourlyRate}>
          {client.defaultHourlyRateMinor === null
            ? null
            : `${formatMoney(client.defaultHourlyRateMinor, client.currency, locale)} without VAT`}
        </Row>
        <Row label={tw.daysToPay}>
          {client.paymentDays === null ? `${paymentDaysDefault} (your default)` : client.paymentDays}
        </Row>
        <Row label={tw.invoiceLanguage}>{LANGUAGE_NAMES[documentLanguage(client.locale)]}</Row>
        <Row label={tw.customerType}>{client.business ? "A business" : "A private customer"}</Row>
        <Row label={tw.vatTreatment}>{VAT_TREATMENT_LABELS[client.vatTreatment].label}</Row>
        {client.notes && <Row label={tw.notes}>{<span className="whitespace-pre-wrap">{client.notes}</span>}</Row>}
      </dl>
    </section>
  );
}

/** The client's figures: what is going on and what is not yet on an invoice. */
export function ClientFigures({ client }: { client: WorkClientItem }) {
  const tw = workText().clientDetail;
  return (
    <StatGrid>
      <Stat label={tw.activeAssignments} value={client.activeAssignments} />
      <Stat
        label={tw.timeLogged}
        value={formatDuration(client.loggedMinutes)}
        sub={`${formatDuration(client.billableMinutes)} billable`}
      />
      <Stat
        label={tw.notInvoiced}
        value={client.unbilledMinutes > 0 ? formatDuration(client.unbilledMinutes) : "Nothing"}
        sub={client.unbilledMinutes > 0 ? tw.billableTimeOnNo : undefined}
      />
    </StatGrid>
  );
}

/** The client's assignments with their figures, each a link to its own page. */
export function ClientAssignments({
  base,
  assignments,
  locale,
}: {
  /** `workBase(store)`. */
  base: string;
  assignments: WorkAssignmentItem[];
  locale: string;
}) {
  const tw = workText().clientDetail;
  if (assignments.length === 0) {
    return (
      <p className={`${card} text-sm text-muted`}>
        {tw.noAssignmentsYetAn}
      </p>
    );
  }
  return (
    <div className={`overflow-x-auto ${CARD_CLASS}`}>
      <table className="w-full text-sm">
        <caption className="sr-only">{tw.assignments}</caption>
        <thead>
          <tr>
            <th scope="col" className={th}>
              {tw.assignment}
            </th>
            <th scope="col" className={th}>
              {tw.billing}
            </th>
            <th scope="col" className={`${th} text-right`}>
              {tw.logged}
            </th>
            <th scope="col" className={`${th} text-right`}>
              {tw.notInvoiced}
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {assignments.map((a) => {
            const s = a.summary;
            return (
              <tr key={a.id}>
                <th scope="row" className="min-w-48 px-4 py-3 text-left font-normal">
                  <Link href={`${base}/assignments/${a.id}`} className="font-medium underline">
                    {a.name}
                  </Link>{" "}
                  <Badge tone={STATUS_TONE[a.status]}>{workText().labels.assignmentStatus[a.status]}</Badge>
                </th>
                <td className="px-4 py-3">
                  {workText().labels.billingType[a.billingType]}
                  <span className="block text-xs text-muted">{rateText(a, locale)}</span>
                </td>
                <td className="px-4 py-3 text-right tabular-nums">
                  {formatDuration(s.loggedMinutes)}
                  {s.estimatedMinutes !== null && (
                    <span
                      className={`block text-xs ${STAGE_STYLES[progressView(s.loggedMinutes, s.estimatedMinutes, a.estimateAlertMinutes).stage].text}`}
                    >
                      {fillWords(workText().clientDetail.ofEstimate, { time: formatDuration(s.estimatedMinutes) })}
                    </span>
                  )}
                </td>
                <td className="px-4 py-3 text-right tabular-nums">
                  {s.unbilledMinutes > 0 || s.unbilledAmountMinor > 0 ? (
                    <>
                      {formatMoney(s.unbilledAmountMinor, a.currency, locale)}
                      <span className="block text-xs text-muted">{formatDuration(s.unbilledMinutes)}</span>
                    </>
                  ) : (
                    <span className="text-muted">{tw.none}</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
