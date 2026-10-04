import Link from "next/link";
import { Suspense } from "react";

import { formatMoney } from "@/lib/money";
import { computeLine } from "@/lib/work-calc";
import { formatDay } from "@/lib/work-dates";
import { scheduleSummary } from "@/lib/work-recurring-ui";
import { memberCan, requirePermission } from "@/server/permissions";
import { listRecurring, type RecurringList, type RecurringSummary } from "@/server/work-recurring";

import { DeleteRecurringButton, NewRecurringButton, TemplateActions } from "./recurring-controls";
import { Badge } from "./work-parts";
import { workBase } from "@/lib/work-paths";

export type RecurringPanelProps = {
  storeSlug: string;
  clientId: string;
  /** The client's currency: a new repeating invoice starts in it. */
  currency: string;
  /** The currencies the store offers. */
  currencies: string[];
  locale: string;
  /** Archived clients take no new repeating invoices. */
  archived: boolean;
};

/**
 * A client's repeating invoices (docs/work.md 5.2, 7.2 WP8): each with its schedule, what it bills,
 * where it stands, and what can be done with it. The invoices themselves are made by the five-minute
 * job, never while this renders; "Generate now" is for when someone does not want to wait. The list is
 * read per request behind a `<Suspense>`.
 */
export function RecurringPanel(props: RecurringPanelProps) {
  return (
    <section aria-labelledby="recurring-heading" className="flex flex-col gap-3" data-slot="client-recurring">
      <Suspense fallback={<h2 id="recurring-heading" className="text-lg font-semibold">Repeating invoices</h2>}>
        <RecurringBody {...props} />
      </Suspense>
    </section>
  );
}

async function RecurringBody(props: RecurringPanelProps) {
  const member = await requirePermission(props.storeSlug, "settings:read");
  const list = await listRecurring(member.store.id, props.clientId);
  return <RecurringPanelView {...props} list={list} canAutoIssue={memberCan(member, "owner")} />;
}

/** What the panel draws, from what was read: no reads of its own, so it draws the same in every state. */
export function RecurringPanelView({
  storeSlug,
  clientId,
  currency,
  currencies,
  locale,
  archived,
  list,
  canAutoIssue,
}: RecurringPanelProps & { list: RecurringList; canAutoIssue: boolean }) {
  const form = { storeSlug, clientId, currency, currencies, today: list.today, canAutoIssue };
  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="recurring-heading" className="text-lg font-semibold">
          Repeating invoices
        </h2>
        {archived ? null : <NewRecurringButton {...form} />}
      </div>
      {list.templates.length === 0 ? (
        <p className="text-sm text-muted">
          Nothing repeats for this client. A repeating invoice makes a draft on each date, for a retainer or a
          subscription, and can issue and email it too.
        </p>
      ) : (
        <ul className="flex flex-col gap-3">
          {list.templates.map((template) => (
            <li key={template.id} className="rounded-lg border border-border bg-background p-4">
              <TemplateCard storeSlug={storeSlug} template={template} form={form} locale={locale} />
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

function TemplateCard({
  storeSlug,
  template,
  form,
  locale,
}: {
  storeSlug: string;
  template: RecurringSummary;
  form: Parameters<typeof TemplateActions>[0]["form"];
  locale: string;
}) {
  // What one invoice bills before VAT, worked out with the same function the invoice is.
  const net = computeLine({
    quantityHundredths: template.quantityHundredths,
    unitPriceMinor: template.unitPriceMinor,
    discountBp: template.discountBp,
    vatBp: 0,
    vatCategory: "standard",
  }).exclMinor;
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="font-medium [overflow-wrap:anywhere]">
            {template.name}{" "}
            {!template.isActive && <Badge tone="warn">Paused</Badge>}{" "}
            {template.autoIssue && <Badge tone="good">Issued by itself</Badge>}
          </h3>
          <p className="text-sm text-muted">
            {formatMoney(net, template.currency, locale)} before VAT · {scheduleSummary(template, locale)}
          </p>
        </div>
        {template.invoiceCount === 0 && (
          <DeleteRecurringButton storeSlug={storeSlug} templateId={template.id} name={template.name} />
        )}
      </div>
      <dl className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
        <div>
          <dt className="inline text-muted">Next: </dt>
          <dd className="inline">{template.next.length > 0 ? template.next.map((d) => formatDay(d, locale)).join(", ") : "none"}</dd>
        </div>
        <div>
          <dt className="inline text-muted">Latest invoice: </dt>
          <dd className="inline">
            {template.last ? (
              <Link href={`${workBase(storeSlug)}/invoices/${template.last.invoiceId}`} className="underline">
                {template.last.documentNumber ?? "Draft"} for {formatDay(template.last.period, locale)}
              </Link>
            ) : (
              "none yet"
            )}
          </dd>
        </div>
      </dl>
      <TemplateActions storeSlug={storeSlug} template={template} form={form} locale={locale} open={template.open} />
    </div>
  );
}
