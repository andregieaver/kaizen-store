import Link from "next/link";
import type { ReactNode } from "react";

import { formatMoney } from "@/lib/money";
import { bpToPercent } from "@/lib/work-calc";
import { dayIn, formatDay } from "@/lib/work-dates";
import { addressText } from "@/lib/work-input";
import { VAT_CATEGORY_LABELS, eventText, languageName, methodLabel, quantityField } from "@/lib/work-invoice-ui";
import { vatNotesFor } from "@/lib/work-vat";
import type { InvoiceDetail, InvoiceLine } from "@/server/work-invoices";

import { CreditInvoiceButton } from "./invoice-credit-dialog";
import { RecordPaymentButton, ReversePaymentButton } from "./invoice-payments";
import { SendCreditNoteButton, SendInvoiceSlot } from "./invoice-send-slot";
import { InvoiceStatusChip } from "./invoice-status";
import { InvoiceTotalsView } from "./invoice-totals";
import { Badge, card, hintText, secondaryButton } from "./work-parts";
import { workBase } from "@/lib/work-paths";
import { workText } from "@/lib/work-text";
import { fillWords } from "@/lib/admin-fill";

export type IssuedViewProps = {
  storeSlug: string;
  locale: string;
  timeZone: string;
  /** An issued invoice's detail: `seller`, `buyer` and the lines are what was frozen when it was issued. */
  detail: InvoiceDetail;
  isOwner: boolean;
  /** The currency of the seller's country, for the VAT stated in it. */
  homeCurrency: string | null;
};

const th = "px-3 py-2 text-left text-eyebrow text-muted uppercase";

/**
 * An issued, paid or void invoice (docs/work.md 4.6): read-only, from what was frozen at issue (the seller and
 * buyer as they were, the lines and amounts), with what has since happened to it: payments, credit notes and the
 * history. The lines and the header cannot be edited; a mistake is a credit note and a new invoice. Actions:
 * record a payment (and reverse one), credit (owners), preview or print the document, and send it (later).
 */
export function IssuedInvoiceView({ storeSlug, locale, timeZone, detail, isOwner, homeCurrency }: IssuedViewProps) {
  const tw = workText().invoiceIssued;
  const { invoice, amounts, seller, buyer, lines, totals } = detail;
  const money = (minor: number) => formatMoney(minor, invoice.currency, locale);
  const when = (iso: string) =>
    new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short", timeZone }).format(new Date(iso));
  const base = `${workBase(storeSlug)}/invoices/${invoice.id}`;
  const notes = vatNotesFor(invoice.vatNotes, invoice.locale, seller?.country);
  const open = invoice.status === "sent";
  const canCredit = invoice.status !== "void";
  const paidDay = invoice.paidAt ? formatDay(dayIn(invoice.paidAt, timeZone), locale) : null;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <InvoiceStatusChip status={invoice.status} dueOn={invoice.dueOn} today={detail.today} showNote />
          {invoice.status === "void" && <span className={hintText}>{tw.fullyCreditedNoPayments}</span>}
        </div>
        <div className="flex flex-wrap items-start gap-2">
          <Link href={`${base}/print`} className={secondaryButton}>
            {tw.previewOrPrint}
          </Link>
          {/* An imported invoice was sent from Kaizen Life: it is never emailed from here. */}
          {!invoice.imported && (
            <SendInvoiceSlot
              storeSlug={storeSlug}
              invoiceId={invoice.id}
              clientEmail={buyer?.email ?? detail.client.billingEmail}
              sentTo={invoice.sentTo}
              canRemind={open && amounts.outstandingMinor > 0}
            />
          )}
          {open && amounts.outstandingMinor > 0 && (
            <RecordPaymentButton
              storeSlug={storeSlug}
              invoiceId={invoice.id}
              currency={invoice.currency}
              locale={locale}
              outstandingMinor={amounts.outstandingMinor}
              today={detail.today}
            />
          )}
          {canCredit && (
            <CreditInvoiceButton
              storeSlug={storeSlug}
              invoiceId={invoice.id}
              documentNumber={invoice.documentNumber ?? ""}
              currency={invoice.currency}
              locale={locale}
              lines={lines}
              creditNotes={detail.creditNotes}
              amounts={amounts}
              today={detail.today}
              isOwner={isOwner}
            />
          )}
        </div>
      </div>

      <section aria-labelledby="amounts-heading" className={card}>
        <h2 id="amounts-heading" className="mb-3 text-title text-ink">
          {tw.amounts}
        </h2>
        <dl className="grid grid-cols-2 gap-4 text-sm sm:grid-cols-4">
          <Amount label={tw.totalWithVat} value={money(amounts.totalMinor)} />
          <Amount label={tw.paid} value={money(amounts.paidMinor)} />
          <Amount label={tw.credited} value={money(amounts.creditedMinor)} />
          <Amount
            label={tw.outstanding}
            value={money(amounts.outstandingMinor)}
            strong={amounts.outstandingMinor > 0}
            note={
              detail.overdue ? `${detail.daysOverdue} ${detail.daysOverdue === 1 ? "day" : "days"} overdue` : undefined
            }
          />
        </dl>
      </section>

      <section aria-labelledby="doc-heading" className={card}>
        <h2 id="doc-heading" className="mb-3 text-title text-ink">
          {tw.theDocument}
        </h2>
        <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2 lg:grid-cols-3">
          <Fact
            label={tw.number}
            value={invoice.documentNumber ?? ""}
            note={invoice.imported ? tw.importedFromKaizenLife : undefined}
          />
          <Fact label={tw.issued} value={invoice.issuedOn ? formatDay(invoice.issuedOn, locale) : "–"} />
          <Fact
            label={tw.due}
            value={invoice.dueOn ? formatDay(invoice.dueOn, locale) : "–"}
            note={`${invoice.effectivePaymentDays} days to pay`}
          />
          {paidDay && <Fact label={tw.paid} value={paidDay} />}
          <Fact
            label={tw.client}
            value={
              <Link href={`${workBase(storeSlug)}/clients/${detail.client.id}`} className="underline">
                {buyer?.name ?? detail.client.name}
              </Link>
            }
          />
          {detail.assignment && <Fact label={tw.assignment} value={detail.assignment.name} />}
          <Fact label={tw.currency} value={invoice.currency} />
          <Fact label={tw.language} value={languageName(invoice.locale)} />
          {invoice.reference && <Fact label={tw.yourReference} value={invoice.reference} />}
          {(invoice.serviceFrom || invoice.serviceTo) && (
            <Fact
              label={tw.period}
              value={[invoice.serviceFrom, invoice.serviceTo]
                .map((day) => (day ? formatDay(day, locale) : "…"))
                .join(" to ")}
            />
          )}
          {invoice.vatHomeMinor !== null && homeCurrency && (
            <Fact
              label={`VAT in ${homeCurrency}`}
              value={formatMoney(invoice.vatHomeMinor, homeCurrency, locale)}
              note={invoice.fxRate ? `Exchange rate ${invoice.fxRate}` : undefined}
            />
          )}
          {invoice.sentTo && <Fact label={tw.emailedTo} value={invoice.sentTo} />}
        </dl>
        {invoice.notes && <p className="mt-4 text-sm whitespace-pre-wrap">{invoice.notes}</p>}
        <div className="mt-5 grid gap-4 border-t border-line pt-4 text-sm sm:grid-cols-2">
          <Party
            title={tw.from}
            lines={[
              seller?.legalName,
              seller?.address,
              seller?.organisationNumber && `Organisation number ${seller.organisationNumber}`,
              seller?.vatRegistered ? seller.vatNumber && `VAT number ${seller.vatNumber}` : tw.notRegisteredForVat,
              seller?.bankAccount && `Account ${seller.bankAccount}${seller.bic ? `, BIC ${seller.bic}` : ""}`,
              seller?.email,
            ]}
          />
          <Party
            title={tw.billTo}
            lines={[
              buyer?.name,
              buyer ? addressText(buyer.address, buyer.country) : null,
              buyer?.organisationNumber && `Organisation number ${buyer.organisationNumber}`,
              buyer?.vatNumber && `VAT number ${buyer.vatNumber}`,
              buyer?.email,
            ]}
          />
        </div>
        <p className={`mt-3 ${hintText}`}>
          {tw.thisIsTheInvoice}
        </p>
      </section>

      <section aria-labelledby="lines-heading" className={card}>
        <h2 id="lines-heading" className="mb-4 text-title text-ink">
          {tw.lines}
        </h2>
        <ol className="flex flex-col gap-3 md:hidden" aria-label={tw.invoiceLines}>
          {lines.map((line) => (
            <li key={line.id} className="rounded-md border border-line p-3 text-sm">
              <p className="font-medium">{line.description}</p>
              <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1">
                <dt className="text-muted">{tw.quantity}</dt>
                <dd className="text-right tabular-nums">{quantityText(line)}</dd>
                <dt className="text-muted">{tw.price}</dt>
                <dd className="text-right tabular-nums">{money(line.unitPriceMinor)}</dd>
                {line.discountBp > 0 && (
                  <>
                    <dt className="text-muted">{tw.discount}</dt>
                    <dd className="text-right tabular-nums">{bpToPercent(line.discountBp)} %</dd>
                  </>
                )}
                <dt className="text-muted">{tw.vat}</dt>
                <dd className="text-right">{vatText(line)}</dd>
                <dt className="text-muted">{tw.withoutVat}</dt>
                <dd className="text-right tabular-nums">{money(line.exclMinor)}</dd>
                <dt className="font-medium">{tw.withVat}</dt>
                <dd className="text-right font-medium tabular-nums">{money(line.inclMinor)}</dd>
              </dl>
              {line.creditedQuantityHundredths > 0 && (
                <p className="mt-2 text-xs text-muted">Credited: {quantityField(line.creditedQuantityHundredths)}</p>
              )}
            </li>
          ))}
        </ol>
        <div className="hidden overflow-x-auto md:block">
          <table className="w-full text-sm">
            <caption className="sr-only">{tw.invoiceLines}</caption>
            <thead>
              <tr>
                <th scope="col" className={th}>
                  {tw.description}
                </th>
                <th scope="col" className={`${th} text-right`}>
                  {tw.quantity}
                </th>
                <th scope="col" className={`${th} text-right`}>
                  {tw.price}
                </th>
                <th scope="col" className={`${th} text-right`}>
                  {tw.discount}
                </th>
                <th scope="col" className={th}>
                  {tw.vat}
                </th>
                <th scope="col" className={`${th} text-right`}>
                  {tw.withoutVat}
                </th>
                <th scope="col" className={`${th} text-right`}>
                  {tw.withVat}
                </th>
              </tr>
            </thead>
            <tbody>
              {lines.map((line) => (
                <tr key={line.id} className="border-t border-line align-top">
                  <td className="px-3 py-2">
                    {line.description}
                    {line.creditedQuantityHundredths > 0 && (
                      <span className="block text-xs text-muted">
                        Credited: {quantityField(line.creditedQuantityHundredths)}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{quantityText(line)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{money(line.unitPriceMinor)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {line.discountBp > 0 ? `${bpToPercent(line.discountBp)} %` : "–"}
                  </td>
                  <td className="px-3 py-2">{vatText(line)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{money(line.exclMinor)}</td>
                  <td className="px-3 py-2 text-right font-medium tabular-nums">{money(line.inclMinor)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="mt-6 border-t border-line pt-4">
          <InvoiceTotalsView totals={totals} currency={invoice.currency} locale={locale} />
          {notes.length > 0 && (
            <ul className="mt-3 list-disc pl-5 text-xs text-muted">
              {notes.map((note) => (
                <li key={note.key}>{note.text}</li>
              ))}
            </ul>
          )}
        </div>
      </section>

      <section aria-labelledby="payments-heading" className={card}>
        <h2 id="payments-heading" className="mb-3 text-title text-ink">
          {tw.payments}
        </h2>
        {detail.payments.length === 0 ? (
          <p className="text-sm text-muted">{tw.noPaymentHasBeen}</p>
        ) : (
          <ul className="flex flex-col divide-y divide-line">
            {detail.payments.map((payment) => {
              const amount = formatMoney(Math.abs(payment.amountMinor), payment.currency, locale);
              const label = fillWords(tw.paymentLabel, { amount, day: formatDay(payment.receivedOn, locale) });
              return (
                <li key={payment.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                  <span className="flex flex-col">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="tabular-nums">
                        {payment.amountMinor < 0 ? "−" : ""}
                        {amount}
                      </span>
                      <span>{formatDay(payment.receivedOn, locale)}</span>
                      <span className="text-muted">{methodLabel(payment.method)}</span>
                      {payment.reversed && <Badge tone="warn">{tw.reversed}</Badge>}
                      {payment.reverses && <Badge>{tw.reversal}</Badge>}
                      {payment.refund && <Badge>{tw.paidBack}</Badge>}
                    </span>
                    <span className="text-xs text-muted">
                      {payment.reference ? `${payment.reference}. ` : ""}
                      {payment.recordedByName ? fillWords(tw.recordedBy, { name: payment.recordedByName }) : ""}
                    </span>
                  </span>
                  {payment.amountMinor > 0 && !payment.reversed && !payment.reverses && (
                    <ReversePaymentButton storeSlug={storeSlug} paymentId={payment.id} label={label} />
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section aria-labelledby="credit-heading" className={card}>
        <h2 id="credit-heading" className="mb-3 text-title text-ink">
          {tw.creditNotes}
        </h2>
        {detail.creditNotes.length === 0 ? (
          <p className="text-sm text-muted">{tw.thisInvoiceHasNot}</p>
        ) : (
          <ul className="flex flex-col divide-y divide-line">
            {detail.creditNotes.map((note) => (
              <li key={note.id} className="flex flex-col gap-1 py-3 text-sm">
                <span className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium">
                    {note.documentNumber}{" "}
                    <span className="font-normal text-muted">{formatDay(note.issuedOn, locale)}</span>
                  </span>
                  <span className="tabular-nums">{formatMoney(note.totalMinor, note.currency, locale)}</span>
                </span>
                {note.reason && <span className="text-muted">{note.reason}</span>}
                <Link href={`${workBase(storeSlug)}/credit-notes/${note.id}/print`} className="self-start underline">
                  {fillWords(tw.previewOrPrintNumber, { number: note.documentNumber })}
                </Link>
                <SendCreditNoteButton
                  storeSlug={storeSlug}
                  creditNoteId={note.id}
                  documentNumber={note.documentNumber}
                  clientEmail={buyer?.email ?? detail.client.billingEmail}
                />
                <span className="text-xs text-muted">
                  {note.lines
                    .map((line) => `${line.description} (${quantityField(line.quantityHundredths)})`)
                    .join(", ")}
                  {note.createdByName ? `. Issued by ${note.createdByName}.` : ""}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="history-heading" className={card}>
        <h2 id="history-heading" className="mb-3 text-title text-ink">
          {tw.history}
        </h2>
        {detail.events.length === 0 ? (
          <p className="text-sm text-muted">{tw.nothingHasHappenedYet}</p>
        ) : (
          <ol className="flex flex-col gap-2 text-sm">
            {detail.events.map((event) => (
              <li key={event.id} className="flex flex-wrap justify-between gap-x-4">
                <span>{eventText(event, (minor, currency) => formatMoney(minor, currency, locale))}</span>
                <span className="text-xs text-muted">
                  {when(event.at)}
                  {event.accountName ? `, ${event.accountName}` : ""}
                </span>
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}

const quantityText = (line: InvoiceLine): string =>
  `${quantityField(line.quantityHundredths)} ${line.unit === "hour" ? "h" : line.quantityHundredths === 100 ? "unit" : "units"}`;

const vatText = (line: InvoiceLine): string =>
  line.vatCategory === "standard"
    ? line.vatBp > 0
      ? `${bpToPercent(line.vatBp)} %`
      : "0 %"
    : VAT_CATEGORY_LABELS[line.vatCategory].replace(" (follows the client)", "");

function Amount({
  label,
  value,
  note,
  strong = false,
}: {
  label: string;
  value: string;
  note?: string;
  strong?: boolean;
}) {
  return (
    <div>
      <dt className="text-muted">{label}</dt>
      <dd className={`text-lg tabular-nums ${strong ? "font-medium" : ""}`}>{value}</dd>
      {note && <dd className="text-xs text-danger-text">{note}</dd>}
    </div>
  );
}

function Fact({ label, value, note }: { label: string; value: ReactNode; note?: string }) {
  return (
    <div>
      <dt className="text-muted">{label}</dt>
      <dd>{value}</dd>
      {note && <dd className="text-xs text-muted">{note}</dd>}
    </div>
  );
}

function Party({ title, lines }: { title: string; lines: (string | null | undefined | false)[] }) {
  const tw = workText().invoiceIssued;
  const shown = lines.filter((line): line is string => Boolean(line));
  return (
    <div>
      <h3 className="mb-1 text-xs tracking-wide text-muted uppercase text-body-strong text-ink">{title}</h3>
      {shown.length === 0 ? (
        <p className="text-muted">{tw.notKept}</p>
      ) : (
        shown.map((line, index) => <p key={index}>{line}</p>)
      )}
    </div>
  );
}
