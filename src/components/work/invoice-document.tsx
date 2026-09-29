import type { ReactNode } from "react";

import { paymentTermsText, vatInCurrencyLabel } from "@/lib/work-invoice-text";
import {
  addressLines,
  countryText,
  dayText,
  moneyText,
  percentText,
  periodText,
  printLocale,
  quantityText,
  rateText,
} from "@/lib/work-invoice-print";
import type {
  BuyerSnapshot,
  CreditNoteDocument,
  DocumentLine,
  InvoiceDocument,
  SellerSnapshot,
} from "@/server/work-invoices";

/**
 * Work's printed documents (docs/work.md 4.7): the invoice and the credit
 * note, drawn from what was frozen when they were issued (`invoiceDocumentData()`,
 * `creditNoteDocumentData()`), in the document's own language. Server-rendered,
 * no hooks, and on purpose black on white whatever the theme or the person's
 * colour mode: it is a legal document that is printed or saved as a PDF.
 *
 * Every text is drawn as text. Descriptions, notes and footers keep their line
 * breaks with `white-space: pre-line`, never as HTML.
 *
 * The style has no `>`, quote or `&` characters: React escapes them in a
 * style element, which would break the rule.
 */
export const DOCUMENT_CSS = `
@page { size: A4; margin: 16mm; }
.wd-screen { background: #f3f4f6; color: #000; padding: 16px; min-height: 100vh; }
.wd, .wd * { box-sizing: border-box; }
.wd { background: #fff; color: #000; max-width: 210mm; margin: 0 auto; padding: 16mm;
  font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif;
  font-size: 10.5pt; line-height: 1.4; box-shadow: 0 1px 12px rgba(0, 0, 0, 0.15); }
.wd h1, .wd h2, .wd p, .wd dl, .wd dd, .wd ul, .wd address, .wd table, .wd figure { margin: 0; padding: 0; }
.wd address { font-style: normal; }
.wd ul { list-style: none; }
.wd h1 { font-size: 22pt; line-height: 1.15; font-weight: 700; }
.wd h2 { font-size: 8.5pt; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; color: #000; margin-bottom: 4px; }
.wd .wd-strong { font-weight: 700; }
.wd .wd-lines { white-space: pre-line; overflow-wrap: anywhere; }
.wd .wd-muted { color: #333; }
.wd .wd-head { display: flex; justify-content: space-between; gap: 16mm; align-items: flex-start; }
.wd .wd-meta { display: grid; grid-template-columns: auto auto; column-gap: 8mm; row-gap: 2px; text-align: left; }
.wd .wd-meta div { display: contents; }
.wd .wd-meta dt { color: #333; }
.wd .wd-meta dd { font-weight: 600; text-align: right; }
.wd .wd-parties { display: grid; grid-template-columns: 1fr 1fr; gap: 12mm; margin-top: 10mm; }
.wd .wd-block { break-inside: avoid; page-break-inside: avoid; margin-top: 8mm; }
.wd table { width: 100%; border-collapse: collapse; table-layout: fixed; }
.wd .wd-table { margin-top: 10mm; }
.wd .wd-table caption { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; }
.wd thead { display: table-header-group; }
.wd th, .wd td { padding: 5px 4px; vertical-align: top; text-align: right; overflow-wrap: anywhere; }
.wd th.wd-left, .wd td.wd-left { text-align: left; }
.wd thead th { font-size: 8.5pt; font-weight: 700; border-bottom: 1.5px solid #000; }
.wd tbody th { font-weight: 400; }
.wd tbody th, .wd tbody td { border-bottom: 0.5px solid #999; }
.wd tr { break-inside: avoid; page-break-inside: avoid; }
.wd .wd-num { font-variant-numeric: tabular-nums; white-space: nowrap; }
.wd .wd-col-desc { width: 38%; }
.wd .wd-col-qty { width: 14%; }
.wd .wd-col-price { width: 16%; }
.wd .wd-col-small { width: 9%; }
.wd .wd-col-amount { width: 16%; }
.wd .wd-bottom { display: grid; grid-template-columns: 1fr 1fr; gap: 12mm; margin-top: 8mm; align-items: start; }
.wd .wd-totals { break-inside: avoid; page-break-inside: avoid; }
.wd .wd-totals dl { display: grid; grid-template-columns: 1fr auto; column-gap: 6mm; row-gap: 3px; }
.wd .wd-totals dd { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
.wd .wd-grand { font-weight: 700; font-size: 12pt; border-top: 1.5px solid #000; padding-top: 4px; margin-top: 2px; }
.wd .wd-summary { font-size: 9.5pt; }
.wd .wd-summary caption { caption-side: top; text-align: left; font-size: 8.5pt; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; margin-bottom: 2px; }
.wd .wd-pay dl { display: grid; grid-template-columns: auto 1fr; column-gap: 6mm; row-gap: 2px; }
.wd .wd-pay dt { color: #333; }
.wd .wd-pay dd { overflow-wrap: anywhere; }
.wd .wd-notes li { margin-top: 3px; }
.wd .wd-footer { margin-top: 10mm; padding-top: 4mm; border-top: 0.5px solid #999; font-size: 9pt; color: #333; }
@media screen and (max-width: 640px) {
  .wd { padding: 6mm; }
  .wd .wd-head, .wd .wd-parties, .wd .wd-bottom { display: block; }
  .wd .wd-parties section, .wd .wd-bottom div { margin-top: 6mm; }
}
@media print {
  html, body { background: #fff !important; }
  .wd-screen { background: #fff; padding: 0; min-height: 0; }
  .wd { max-width: none; margin: 0; padding: 0; box-shadow: none; }
}
`;

type Doc = InvoiceDocument | CreditNoteDocument;

/** The document's own styles, once per page. */
function DocumentStyle() {
  return <style>{DOCUMENT_CSS}</style>;
}

function Seller({ doc, locale }: { doc: Doc; locale: string }) {
  const s: SellerSnapshot = doc.seller;
  const l = doc.labels;
  const country = countryText(s.country, locale);
  return (
    <section aria-label={l.from}>
      <h2>{l.from}</h2>
      <address>
        {s.legalName && <p className="wd-strong">{s.legalName}</p>}
        {s.address && <p className="wd-lines">{s.address}</p>}
        {country && <p>{country}</p>}
        {s.organisationNumber && (
          <p>
            {l.organisationNumber} {s.organisationNumber}
          </p>
        )}
        {s.vatNumber && (
          <p>
            {l.vatNumber} {s.vatNumber}
          </p>
        )}
        {s.email && <p>{s.email}</p>}
      </address>
    </section>
  );
}

function Buyer({ doc, locale }: { doc: Doc; locale: string }) {
  const b: BuyerSnapshot = doc.buyer;
  const l = doc.labels;
  const lines = addressLines(b.address);
  const country = countryText(b.country, locale);
  return (
    <section aria-label={l.billTo}>
      <h2>{l.billTo}</h2>
      <address>
        {b.name && <p className="wd-strong">{b.name}</p>}
        {b.contactName && b.contactName !== b.name && <p>{b.contactName}</p>}
        {lines.map((line, i) => (
          <p key={i} className="wd-lines">
            {line}
          </p>
        ))}
        {country && <p>{country}</p>}
        {b.organisationNumber && (
          <p>
            {l.organisationNumber} {b.organisationNumber}
          </p>
        )}
        {b.vatNumber && (
          <p>
            {l.vatNumber} {b.vatNumber}
          </p>
        )}
      </address>
    </section>
  );
}

function LineTable({ doc, locale, caption, factor }: { doc: Doc; locale: string; caption: string; factor: 1 | -1 }) {
  const l = doc.labels;
  const money = (minor: number) => moneyText(minor * factor, doc.currency, locale);
  const row = (line: DocumentLine, i: number) => (
    <tr key={i}>
      <th scope="row" className="wd-left wd-lines">
        {line.description}
      </th>
      <td className="wd-num">{quantityText(line, locale, l)}</td>
      <td className="wd-num">{moneyText(line.unitPriceMinor, doc.currency, locale)}</td>
      <td className="wd-num">{line.discountBp > 0 ? percentText(line.discountBp, locale) : ""}</td>
      <td className="wd-num">{percentText(line.vatBp, locale)}</td>
      <td className="wd-num">{money(line.exclMinor)}</td>
    </tr>
  );
  return (
    <table className="wd-table">
      <caption>{caption}</caption>
      <colgroup>
        <col className="wd-col-desc" />
        <col className="wd-col-qty" />
        <col className="wd-col-price" />
        <col className="wd-col-small" />
        <col className="wd-col-small" />
        <col className="wd-col-amount" />
      </colgroup>
      <thead>
        <tr>
          <th scope="col" className="wd-left">
            {l.description}
          </th>
          <th scope="col">{l.quantity}</th>
          <th scope="col">{l.unitPrice}</th>
          <th scope="col">{l.discount}</th>
          <th scope="col">{l.vatRate}</th>
          <th scope="col">{l.amountExclVat}</th>
        </tr>
      </thead>
      <tbody>{doc.lines.map(row)}</tbody>
    </table>
  );
}

function VatSummary({ doc, locale, factor }: { doc: Doc; locale: string; factor: 1 | -1 }) {
  const l = doc.labels;
  const money = (minor: number) => moneyText(minor * factor, doc.currency, locale);
  return (
    <table className="wd-summary">
      <caption>{l.vatSummary}</caption>
      <thead>
        <tr>
          <th scope="col" className="wd-left">
            {l.vatRate}
          </th>
          <th scope="col">{l.vatBasis}</th>
          <th scope="col">{l.vat}</th>
        </tr>
      </thead>
      <tbody>
        {doc.totals.vatGroups.map((g) => (
          <tr key={`${g.category}:${g.vatBp}`}>
            <th scope="row" className="wd-left">
              {percentText(g.vatBp, locale)}
            </th>
            <td className="wd-num">{money(g.netMinor)}</td>
            <td className="wd-num">{money(g.vatMinor)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Totals({ doc, locale, factor, children }: { doc: Doc; locale: string; factor: 1 | -1; children?: ReactNode }) {
  const l = doc.labels;
  const money = (minor: number) => moneyText(minor * factor, doc.currency, locale);
  const home = doc.vatHome;
  return (
    <div className="wd-totals">
      <dl>
        <dt>{l.subtotalExclVat}</dt>
        <dd>{money(doc.totals.subtotalMinor)}</dd>
        <dt>{l.vat}</dt>
        <dd>{money(doc.totals.vatMinor)}</dd>
        <dt className="wd-grand">{l.totalInclVat}</dt>
        <dd className="wd-grand">{money(doc.totals.totalMinor)}</dd>
        {home && (
          <>
            <dt>{vatInCurrencyLabel(doc.language, home.currency)}</dt>
            <dd>{moneyText(home.amountMinor * factor, home.currency, locale)}</dd>
          </>
        )}
        {children}
      </dl>
      {home && (
        <p className="wd-muted" style={{ marginTop: 3, fontSize: "9pt", textAlign: "right" }}>
          1 {doc.currency} = {rateText(home.rate)} {home.currency}
        </p>
      )}
    </div>
  );
}

function Notes({ doc, notes }: { doc: Doc; notes: string | null }) {
  const vat = doc.vatNotes;
  if (!notes?.trim() && vat.length === 0) return null;
  return (
    <section className="wd-block wd-notes" aria-label={doc.labels.notes}>
      <h2>{doc.labels.notes}</h2>
      <ul>
        {notes?.trim() && <li className="wd-lines">{notes}</li>}
        {vat.map((n) => (
          <li key={n.key} className="wd-lines">
            {n.text}
          </li>
        ))}
      </ul>
    </section>
  );
}

function Footer({ doc }: { doc: Doc }) {
  const footer = doc.seller.invoiceFooter?.trim();
  if (!footer) return null;
  return <footer className="wd-footer wd-lines">{footer}</footer>;
}

/** The title and the facts under it: dates, period, reference. */
function Head({ doc, title, facts }: { doc: Doc; title: string; facts: [string, string][] }) {
  return (
    <header className="wd-head">
      <div>
        <h1>{title}</h1>
        {doc.documentNumber && <p className="wd-strong">{doc.documentNumber}</p>}
      </div>
      <dl className="wd-meta" aria-label={title}>
        {facts
          .filter(([, value]) => value)
          .map(([label, value]) => (
            <div key={label}>
              <dt>{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
      </dl>
    </header>
  );
}

/**
 * An issued invoice. Give it `invoiceDocumentData()` of an issued invoice (the
 * print page checks `printableState()` first); it draws exactly what is in
 * it and works nothing out again.
 */
export function InvoiceDocumentView({ doc }: { doc: InvoiceDocument }) {
  const l = doc.labels;
  const locale = printLocale(doc.locale);
  const money = (minor: number) => moneyText(minor, doc.currency, locale);
  const title = `${l.invoice}${doc.documentNumber ? ` ${doc.documentNumber}` : ""}`;
  const p = doc.payment;
  const paid = doc.amounts.paidMinor;
  const credited = doc.amounts.creditedMinor;
  const adjusted = !doc.draft && (paid > 0 || credited > 0);
  return (
    <article className="wd" lang={doc.language} aria-label={title}>
      <DocumentStyle />
      <Head
        doc={doc}
        title={l.invoice}
        facts={[
          [l.issueDate, dayText(doc.issuedOn, locale)],
          [l.dueDate, dayText(doc.dueOn, locale)],
          [l.servicePeriod, periodText(doc.servicePeriod, locale)],
          [l.yourReference, doc.reference?.trim() ?? ""],
        ]}
      />
      <div className="wd-parties">
        <Seller doc={doc} locale={locale} />
        <Buyer doc={doc} locale={locale} />
      </div>
      <LineTable doc={doc} locale={locale} caption={title} factor={1} />
      <div className="wd-bottom">
        <VatSummary doc={doc} locale={locale} factor={1} />
        <Totals doc={doc} locale={locale} factor={1}>
          {adjusted && (
            <>
              {paid > 0 && (
                <>
                  <dt>{l.paid}</dt>
                  <dd>{money(-paid)}</dd>
                </>
              )}
              {credited > 0 && (
                <>
                  <dt>{l.creditNote}</dt>
                  <dd>{money(-credited)}</dd>
                </>
              )}
              <dt className="wd-strong">{l.amountDue}</dt>
              <dd className="wd-strong">{money(doc.amounts.outstandingMinor)}</dd>
            </>
          )}
        </Totals>
      </div>
      <section className="wd-block wd-pay" aria-label={l.paymentDetails}>
        <h2>{l.paymentDetails}</h2>
        <dl>
          <dt>{l.amountDue}</dt>
          <dd className="wd-strong wd-num">{money(p.amountDueMinor)}</dd>
          {p.dueOn && (
            <>
              <dt>{l.dueDate}</dt>
              <dd>{dayText(p.dueOn, locale)}</dd>
            </>
          )}
          {p.bankAccount && (
            <>
              <dt>{l.bankAccount}</dt>
              <dd>{p.bankAccount}</dd>
            </>
          )}
          {p.bic && (
            <>
              <dt>{l.bic}</dt>
              <dd>{p.bic}</dd>
            </>
          )}
          {p.paymentReference && (
            <>
              <dt>{l.paymentReference}</dt>
              <dd>{p.paymentReference}</dd>
            </>
          )}
        </dl>
        {p.note?.trim() && <p className="wd-lines">{p.note}</p>}
        {doc.paymentDays !== null && <p>{paymentTermsText(doc.language, doc.paymentDays)}</p>}
        <p className="wd-muted">{doc.latePaymentNote}</p>
      </section>
      <Notes doc={doc} notes={doc.notes} />
      {doc.creditNotes.length > 0 && (
        <section className="wd-block" aria-label={l.creditNote}>
          <h2>{l.creditNote}</h2>
          <ul>
            {doc.creditNotes.map((c) => (
              <li key={c.id} className="wd-num">
                {l.creditNote} {c.documentNumber} · {dayText(c.issuedOn, locale)} ·{" "}
                {moneyText(-c.totalMinor, c.currency, locale)}
              </li>
            ))}
          </ul>
        </section>
      )}
      <Footer doc={doc} />
    </article>
  );
}

/**
 * A credit note, from `creditNoteDocumentData()`: the credited lines and their
 * VAT as negative amounts, the reference to the invoice it corrects and the
 * wording of `creditNoteWording()` (whether it cancels the invoice or part of
 * it, and that money already paid is settled separately).
 */
export function CreditNoteDocumentView({ doc }: { doc: CreditNoteDocument }) {
  const l = doc.labels;
  const locale = printLocale(doc.locale);
  const title = `${doc.wording.title} ${doc.documentNumber}`;
  return (
    <article className="wd" lang={doc.language} aria-label={title}>
      <DocumentStyle />
      <Head
        doc={doc}
        title={doc.wording.title}
        facts={[
          [l.issueDate, dayText(doc.issuedOn, locale)],
          [l.creditedInvoice, doc.invoiceNumber],
          [l.reason, doc.reason?.trim() ?? ""],
        ]}
      />
      <div className="wd-parties">
        <Seller doc={doc} locale={locale} />
        <Buyer doc={doc} locale={locale} />
      </div>
      <section className="wd-block" aria-label={l.creditedInvoice}>
        <p className="wd-strong">{doc.wording.statement}</p>
        <p className="wd-muted">{doc.wording.settlement}</p>
      </section>
      <LineTable doc={doc} locale={locale} caption={title} factor={-1} />
      <div className="wd-bottom">
        <VatSummary doc={doc} locale={locale} factor={-1} />
        <Totals doc={doc} locale={locale} factor={-1} />
      </div>
      <Notes doc={doc} notes={null} />
      <Footer doc={doc} />
    </article>
  );
}
