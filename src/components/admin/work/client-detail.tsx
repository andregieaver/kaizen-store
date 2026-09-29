import Link from "next/link";
import type { ReactNode } from "react";

import { Stat, StatGrid } from "@/components/admin/overview-parts";
import { formatMoney } from "@/lib/money";
import { addressText } from "@/lib/work-input";
import { documentLanguage } from "@/lib/work-invoice-text";
import { VAT_TREATMENT_LABELS } from "@/lib/work-vat";
import { formatDuration } from "@/lib/work-time";
import { ASSIGNMENT_STATUS_LABELS, BILLING_TYPE_LABELS, STAGE_STYLES, progressView } from "@/lib/work-ui";
import type { WorkAssignmentItem, WorkClientItem } from "@/server/work";

import { Badge, card } from "./work-parts";

const th = "px-4 py-2 text-left text-xs font-medium tracking-wide text-muted uppercase";

const LANGUAGE_NAMES = { nb: "Norwegian", sv: "Swedish", da: "Danish", en: "English" } as const;

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <dt className="text-muted">{label}</dt>
      <dd className="min-w-0 [overflow-wrap:anywhere]">{children ?? <span className="text-muted">Not set</span>}</dd>
    </>
  );
}

const STATUS_TONE = { active: "good", paused: "warn", done: "neutral" } as const;

/** The rate an assignment is billed at, in words. */
export function rateText(assignment: WorkAssignmentItem, locale: string): string {
  if (assignment.billingType === "fixed_fee") {
    return assignment.fixedAmountMinor === null
      ? "Fixed fee"
      : `${formatMoney(assignment.fixedAmountMinor, assignment.currency, locale)} fixed`;
  }
  const { rateMinor, rateSource } = assignment.summary;
  if (rateSource === "none") return "No rate";
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
  const address = addressText(client.billingAddress);
  return (
    <section aria-labelledby="client-details-heading" className={card}>
      <h2 id="client-details-heading" className="mb-3 font-medium">
        Details
      </h2>
      <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-[11rem_1fr]">
        <Row label="Legal name">{client.legalName}</Row>
        <Row label="Organisation number">{client.organisationNumber}</Row>
        <Row label="VAT number">{client.vatNumber}</Row>
        <Row label="Address">{address || null}</Row>
        <Row label="Country">{client.country}</Row>
        <Row label="Contact">{[client.contactName, client.phone].filter(Boolean).join(", ") || null}</Row>
        <Row label="Invoice email">{client.billingEmail}</Row>
        <Row label="Currency">{client.currency}</Row>
        <Row label="Hourly rate">
          {client.defaultHourlyRateMinor === null
            ? null
            : `${formatMoney(client.defaultHourlyRateMinor, client.currency, locale)} without VAT`}
        </Row>
        <Row label="Days to pay">
          {client.paymentDays === null ? `${paymentDaysDefault} (your default)` : client.paymentDays}
        </Row>
        <Row label="Invoice language">{LANGUAGE_NAMES[documentLanguage(client.locale)]}</Row>
        <Row label="Customer type">{client.business ? "A business" : "A private customer"}</Row>
        <Row label="VAT treatment">{VAT_TREATMENT_LABELS[client.vatTreatment].label}</Row>
        {client.notes && <Row label="Notes">{<span className="whitespace-pre-wrap">{client.notes}</span>}</Row>}
      </dl>
    </section>
  );
}

/** The client's figures: what is going on and what is not yet on an invoice. */
export function ClientFigures({ client }: { client: WorkClientItem }) {
  return (
    <StatGrid>
      <Stat label="Active assignments" value={client.activeAssignments} />
      <Stat
        label="Time logged"
        value={formatDuration(client.loggedMinutes)}
        sub={`${formatDuration(client.billableMinutes)} billable`}
      />
      <Stat
        label="Not invoiced"
        value={client.unbilledMinutes > 0 ? formatDuration(client.unbilledMinutes) : "Nothing"}
        sub={client.unbilledMinutes > 0 ? "Billable time on no invoice" : undefined}
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
  /** `/admin/{store}/work`. */
  base: string;
  assignments: WorkAssignmentItem[];
  locale: string;
}) {
  if (assignments.length === 0) {
    return (
      <p className={`${card} text-sm text-muted`}>
        No assignments yet. An assignment is a job for this client: log time on it, then invoice the time.
      </p>
    );
  }
  return (
    <div className="overflow-x-auto rounded-lg border border-border bg-background">
      <table className="w-full text-sm">
        <caption className="sr-only">Assignments</caption>
        <thead>
          <tr>
            <th scope="col" className={th}>
              Assignment
            </th>
            <th scope="col" className={th}>
              Billing
            </th>
            <th scope="col" className={`${th} text-right`}>
              Logged
            </th>
            <th scope="col" className={`${th} text-right`}>
              Not invoiced
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {assignments.map((a) => {
            const s = a.summary;
            return (
              <tr key={a.id}>
                <th scope="row" className="min-w-48 px-4 py-3 text-left font-normal">
                  <Link href={`${base}/assignments/${a.id}`} className="font-medium underline">
                    {a.name}
                  </Link>{" "}
                  <Badge tone={STATUS_TONE[a.status]}>{ASSIGNMENT_STATUS_LABELS[a.status]}</Badge>
                </th>
                <td className="px-4 py-3">
                  {BILLING_TYPE_LABELS[a.billingType]}
                  <span className="block text-xs text-muted">{rateText(a, locale)}</span>
                </td>
                <td className="px-4 py-3 text-right tabular-nums">
                  {formatDuration(s.loggedMinutes)}
                  {s.estimatedMinutes !== null && (
                    <span
                      className={`block text-xs ${STAGE_STYLES[progressView(s.loggedMinutes, s.estimatedMinutes, a.estimateAlertMinutes).stage].text}`}
                    >
                      of {formatDuration(s.estimatedMinutes)}
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
                    <span className="text-muted">None</span>
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
