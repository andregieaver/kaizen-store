import { DOCUMENT_CSS } from "@/components/work/invoice-document";
import type { CreditNoteSnapshot, CreditRow } from "@/lib/credit-allocation";
import type { OrderInvoiceSnapshot, SnapshotBucket, SnapshotLine, SnapshotShipping, SnapshotVatHome } from "@/lib/invoice-snapshot";
import { documentText, treatmentStatements, type DocumentText } from "@/lib/invoice-text";
import { minorUnitDigits } from "@/lib/money";
import { addressLines, countryText, dayText, moneyText, percentText, printLocale, rateText } from "@/lib/work-invoice-print";

/**
 * An invoice or a credit note for a shop order, drawn only from its frozen snapshot (D159, `docs/wave-1b-invoices.md` 3.4, 4.3 and 5.3):
 * the hosted page, the print page and the PDF all draw this one component, so what a shopper reads is what the PDF holds. Server-rendered,
 * no hooks, on purpose black on white whatever the theme or the person's colour mode: it is a legal document that is printed or saved as a PDF.
 * It works nothing out again: every amount is the snapshot's, and the only arithmetic here is the sign of a credit and a rate shown in major units.
 *
 * Every text is drawn as text (a title, a name, a note keep their line breaks with `white-space: pre-line`, never as HTML), and the wording is
 * `invoice-text.ts`'s: hand-written nb, sv, da and en, English for every other language, flagged for review by an accountant or lawyer. A
 * buyer's VAT number is printed only when the snapshot carries one (a reverse-charge invoice), and VIES's answer is in no snapshot.
 *
 * The page has no external resource: no font, no picture, no link, so the PDF renderer can refuse every request. The style has no `>`, quote or
 * `&` characters: React escapes them in a style element, which would break the rule.
 */

/** What this document adds to Work's printed-document styles (the shared `.wd` classes): wider tables, a note under a line, the statements. */
const EXTRA_CSS = `
.wd .wd-col-name { width: 31%; }
.wd .wd-col-qty-s { width: 8%; }
.wd .wd-col-money { width: 13%; }
.wd .wd-col-rate { width: 9%; }
.wd .wd-line-note { display: block; font-size: 9pt; color: #333; }
.wd .wd-statements li { margin-top: 3px; }
.wd .wd-credit-neg { white-space: nowrap; }
.wd .wd-position dl { display: grid; grid-template-columns: 1fr auto; column-gap: 6mm; row-gap: 2px; }
.wd .wd-position dd { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
`;

type Doc = OrderInvoiceSnapshot | CreditNoteSnapshot;

const isCredit = (doc: Doc): doc is CreditNoteSnapshot => doc.documentType === "credit_note";

/**
 * A seller who is not registered for VAT may not state any VAT on the document, nor say that an amount includes it (Denmark's momsloven
 * 52 a, read 2026-10-04; the same principle is general, the other countries' acts not read: needs review). Such a document is drawn without
 * a rate, a VAT amount, a VAT table or an ex-VAT/incl.-VAT split: one amount per row and one total, and the not-registered sentence.
 */
const hidesVat = (doc: Doc): boolean => !doc.seller.vatRegistered || doc.treatment.statements.includes("not_registered");

/** An invoice with something paid online (a payment day exists); a booking left wholly for the venue has been paid for nothing yet. */
const paidOnline = (doc: OrderInvoiceSnapshot): boolean => doc.payments.some((p) => p.kind === "paid_online" || p.kind === "paid_outside");
const bp = (rate: number) => Math.round(rate * 10_000);

/** The rate of the VAT line in major units (so a currency with another number of decimals still reads right), without trailing zeros. */
function homeRateText(home: SnapshotVatHome, currency: string): string {
  const shown = home.fxRate * 10 ** (minorUnitDigits(currency) - minorUnitDigits(home.currency));
  return rateText(shown.toFixed(6));
}

/** `2026-10-04T14:30` as a day and a time in the document's locale; text that is not that is shown as it is. */
function localTimeText(value: string, locale: string): string {
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/.exec(value);
  return m ? `${dayText(m[1], locale)} ${m[2]}` : value;
}

function serviceText(line: SnapshotLine, locale: string): string | null {
  if (!line.service) return line.serviceDate ? dayText(line.serviceDate, locale) : null;
  const from = localTimeText(line.service.startsAt, locale);
  const to = localTimeText(line.service.endsAt, locale);
  return from === to ? from : `${from} – ${to}`;
}

function Head({ doc, t, locale }: { doc: Doc; t: DocumentText; locale: string }) {
  const credit = isCredit(doc);
  const title = credit ? t.creditNote : t.invoice;
  // The payment day and the supply date (which is the payment day) are printed only when something was paid online: a booking whose whole total
  // is left for the venue asserts no payment, and its services carry their own dates.
  const paid = !credit && paidOnline(doc);
  const facts: [string, string][] = [
    [t.issueDate, dayText(doc.issuedOn, locale)],
    ...(paid ? ([[t.supplyDate, dayText(doc.supplyDate, locale)]] as [string, string][]) : []),
    [t.orderNumber, doc.order.number],
    // "Paid online" only when Stripe took the money; a payment the seller recorded outside Kaizen is dated in its own words (D173).
    ...(paid
      ? ([[!credit && doc.payments.some((p) => p.kind === "paid_online") ? t.paidOn : t.paidOutside, dayText(doc.order.paidOn, locale)]] as [string, string][])
      : []),
  ];
  return (
    <header className="wd-head">
      <div>
        <h1>{title}</h1>
        <p className="wd-strong">{doc.number}</p>
      </div>
      <dl className="wd-meta" aria-label={`${title} ${doc.number}`}>
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

function Seller({ doc, t, locale }: { doc: Doc; t: DocumentText; locale: string }) {
  const s = doc.seller;
  const country = countryText(s.country, locale);
  // Norway: the organisation number is followed by "MVA" when the seller is registered for VAT (bokføringsforskriften § 5-1-2; needs review).
  const org = s.organisationNumber ? (s.country === "NO" && s.vatRegistered ? `${s.organisationNumber} MVA` : s.organisationNumber) : null;
  return (
    <section aria-label={t.seller}>
      <h2>{t.seller}</h2>
      <address>
        {s.legalName && <p className="wd-strong">{s.legalName}</p>}
        {s.address && <p className="wd-lines">{s.address}</p>}
        {country && <p>{country}</p>}
        {org && (
          <p>
            {t.organisationNumber} {org}
          </p>
        )}
        {s.vatNumber && (
          <p>
            {t.vatNumber} {s.vatNumber}
          </p>
        )}
        {s.email && <p>{s.email}</p>}
      </address>
    </section>
  );
}

function Buyer({ doc, t, locale }: { doc: Doc; t: DocumentText; locale: string }) {
  const b = doc.buyer;
  const lines = addressLines(b.address);
  const country = countryText(b.address.country, locale);
  const name = b.company ?? b.name;
  return (
    <section aria-label={t.buyer}>
      <h2>{t.buyer}</h2>
      <address>
        {name && <p className="wd-strong">{name}</p>}
        {b.company && b.name && b.name !== b.company && <p>{b.name}</p>}
        {lines.map((line, i) => (
          <p key={i} className="wd-lines">
            {line}
          </p>
        ))}
        {country && <p>{country}</p>}
        {b.organisationNumber && (
          <p>
            {t.organisationNumber} {b.organisationNumber}
          </p>
        )}
        {b.vatNumber && (
          <p>
            {t.vatNumber} {b.vatNumber}
          </p>
        )}
        {b.email && <p>{b.email}</p>}
        {!isCredit(doc) && doc.order.deliveryPlace && (doc.order.deliveryPlace.city || doc.order.deliveryPlace.country) && (
          <p className="wd-muted">
            {t.deliveryPlace}: {[doc.order.deliveryPlace.city, countryText(doc.order.deliveryPlace.country, locale)].filter(Boolean).join(", ")}
          </p>
        )}
      </address>
    </section>
  );
}

function InvoiceLines({ doc, t, locale }: { doc: OrderInvoiceSnapshot; t: DocumentText; locale: string }) {
  const money = (minor: number) => moneyText(minor, doc.currency, locale);
  const title = `${t.invoice} ${doc.number}`;
  const shipping: SnapshotShipping | null = doc.shipping;
  const vat = !hidesVat(doc);
  return (
    <table className="wd-table">
      <caption>{title}</caption>
      <colgroup>
        <col className="wd-col-name" />
        <col className="wd-col-qty-s" />
        <col className="wd-col-money" />
        <col className="wd-col-money" />
        <col className="wd-col-money" />
        {vat && <col className="wd-col-rate" />}
        {vat && <col className="wd-col-money" />}
      </colgroup>
      <thead>
        <tr>
          <th scope="col" className="wd-left">
            {t.description}
          </th>
          <th scope="col">{t.quantity}</th>
          <th scope="col">{vat ? t.unitPriceExVat : t.unitPrice}</th>
          <th scope="col">{vat ? t.discountExVat : t.discount}</th>
          <th scope="col">{vat ? t.amountExVat : t.amount}</th>
          {vat && <th scope="col">{t.vatRate}</th>}
          {vat && <th scope="col">{t.vatAmount}</th>}
        </tr>
      </thead>
      <tbody>
        {doc.lines.map((line) => {
          const service = serviceText(line, locale);
          return (
            <tr key={line.lineId}>
              <th scope="row" className="wd-left wd-lines">
                {line.title}
                {service && <span className="wd-line-note">{`${t.booked}: ${service}`}</span>}
              </th>
              <td className="wd-num">{line.quantity}</td>
              <td className="wd-num">{money(line.unitNetMinor)}</td>
              <td className="wd-num">{line.discountNetMinor > 0 ? money(line.discountNetMinor) : ""}</td>
              <td className="wd-num">{money(line.netMinor)}</td>
              {vat && <td className="wd-num">{percentText(bp(line.vatRate), locale)}</td>}
              {vat && <td className="wd-num">{money(line.vatMinor)}</td>}
            </tr>
          );
        })}
        {shipping && (
          <tr>
            <th scope="row" className="wd-left wd-lines">
              {shipping.label ?? t.shipping}
            </th>
            <td className="wd-num">1</td>
            <td className="wd-num">{money(shipping.netBeforeMinor)}</td>
            <td className="wd-num">{shipping.discountNetMinor > 0 ? money(shipping.discountNetMinor) : ""}</td>
            <td className="wd-num">{money(shipping.netMinor)}</td>
            {vat && <td className="wd-num">{percentText(bp(shipping.vatRate), locale)}</td>}
            {vat && <td className="wd-num">{money(shipping.vatMinor)}</td>}
          </tr>
        )}
      </tbody>
    </table>
  );
}

/** A credit note's rows: what was credited, as negative amounts (a deduction, which reduces the credit, as a positive one). */
function CreditLines({ doc, t, locale }: { doc: CreditNoteSnapshot; t: DocumentText; locale: string }) {
  const money = (minor: number) => moneyText(-minor, doc.currency, locale);
  const title = `${t.creditNote} ${doc.number}`;
  const describe = (row: CreditRow): string => [t.creditRows[row.kind], row.title].filter(Boolean).join(": ");
  const vat = !hidesVat(doc);
  return (
    <table className="wd-table">
      <caption>{title}</caption>
      <colgroup>
        <col style={{ width: vat ? "46%" : "70%" }} />
        <col className="wd-col-qty-s" />
        {vat && <col className="wd-col-rate" />}
        {vat && <col className="wd-col-money" />}
        {vat && <col className="wd-col-money" />}
        <col className="wd-col-money" />
      </colgroup>
      <thead>
        <tr>
          <th scope="col" className="wd-left">
            {t.description}
          </th>
          <th scope="col">{t.quantity}</th>
          {vat && <th scope="col">{t.vatRate}</th>}
          {vat && <th scope="col">{t.amountExVat}</th>}
          {vat && <th scope="col">{t.vatAmount}</th>}
          <th scope="col">{vat ? t.amountInclVat : t.amount}</th>
        </tr>
      </thead>
      <tbody>
        {doc.lines.map((row, i) => (
          <tr key={i}>
            <th scope="row" className="wd-left wd-lines">
              {describe(row)}
            </th>
            <td className="wd-num">{row.quantity ?? ""}</td>
            {vat && <td className="wd-num">{percentText(bp(row.vatRate), locale)}</td>}
            {vat && <td className="wd-num">{row.netMinor === null ? "" : money(row.netMinor)}</td>}
            {vat && <td className="wd-num">{row.vatMinor === null ? "" : money(row.vatMinor)}</td>}
            <td className="wd-num">{money(row.grossMinor)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function VatByRate({ doc, t, locale, sign }: { doc: Doc; t: DocumentText; locale: string; sign: 1 | -1 }) {
  const money = (minor: number) => moneyText(minor * sign, doc.currency, locale);
  const label = (b: SnapshotBucket) => (b.basis === "standard" ? percentText(bp(b.rate), locale) : `${percentText(bp(b.rate), locale)} (${t.basis[b.basis]})`);
  return (
    <table className="wd-summary">
      <caption>{t.vatByRate}</caption>
      <thead>
        <tr>
          <th scope="col" className="wd-left">
            {t.rate}
          </th>
          <th scope="col">{t.taxableAmount}</th>
          <th scope="col">{t.vat}</th>
          <th scope="col">{t.amountInclVat}</th>
        </tr>
      </thead>
      <tbody>
        {doc.buckets.map((b) => (
          <tr key={`${b.rate}:${b.basis}`}>
            <th scope="row" className="wd-left">
              {label(b)}
            </th>
            <td className="wd-num">{money(b.netMinor)}</td>
            <td className="wd-num">{money(b.vatMinor)}</td>
            <td className="wd-num">{money(b.grossMinor)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Totals({ doc, t, locale, sign }: { doc: Doc; t: DocumentText; locale: string; sign: 1 | -1 }) {
  const money = (minor: number) => moneyText(minor * sign, doc.currency, locale);
  const vat = !hidesVat(doc);
  const home = vat ? doc.vatHome : null;
  return (
    <div className="wd-totals">
      <dl>
        {vat && <dt>{t.totalExVat}</dt>}
        {vat && <dd>{money(doc.totals.netMinor)}</dd>}
        {vat && <dt>{t.totalVat}</dt>}
        {vat && <dd>{money(doc.totals.vatMinor)}</dd>}
        <dt className="wd-grand">{isCredit(doc) ? t.totalCredited : t.total}</dt>
        <dd className="wd-grand">{money(doc.totals.grossMinor)}</dd>
      </dl>
      {home && (
        <p className="wd-muted" style={{ marginTop: 3, fontSize: "9pt", textAlign: "right" }}>
          {t.vatHome({
            currency: home.currency,
            amount: moneyText(home.vatMinor * sign, home.currency, locale),
            fromCurrency: doc.currency,
            rate: homeRateText(home, doc.currency),
            asOf: dayText(home.asOf, locale),
          })}
        </p>
      )}
    </div>
  );
}

function Statements({ doc, t, lang }: { doc: Doc; t: DocumentText; lang: string }) {
  const tr = doc.treatment;
  const statements = treatmentStatements(lang, tr);
  const reverse = statements.some((s) => s.key === "reverse_charge");
  if (statements.length === 0) return null;
  return (
    <section className="wd-block wd-notes wd-statements" aria-label={t.vatByRate}>
      <ul>
        {statements.map((s) => (
          <li key={s.key} className="wd-strong">
            {s.text}
          </li>
        ))}
        {reverse && tr.sellerVatNumber && (
          <li>
            {t.sellerVatNumber}: {tr.sellerVatNumber}
          </li>
        )}
        {reverse && tr.buyerVatNumber && (
          <li>
            {t.buyerVatNumber}: {tr.buyerVatNumber}
          </li>
        )}
      </ul>
    </section>
  );
}

function Payments({ doc, t, locale }: { doc: OrderInvoiceSnapshot; t: DocumentText; locale: string }) {
  if (doc.payments.length === 0) return null;
  return (
    <section className="wd-block wd-pay" aria-label={t.payment}>
      <h2>{t.payment}</h2>
      <dl>
        {doc.payments.map((p, i) => (
          <div key={i} style={{ display: "contents" }}>
            <dt>
              {p.kind === "paid_online"
                ? t.paidOnline
                : p.kind === "paid_outside"
                  ? `${t.paidOutside}${p.method ? ` (${t.paymentMethods[p.method]})` : ""}`
                  : t.payAtVenue}
            </dt>
            <dd className="wd-num">{moneyText(p.amountMinor, doc.currency, locale)}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

function Discounts({ doc, t, locale }: { doc: OrderInvoiceSnapshot; t: DocumentText; locale: string }) {
  if (doc.discounts.length === 0) return null;
  return (
    <section className="wd-block" aria-label={t.discountsGiven}>
      <h2>{t.discountsGiven}</h2>
      <ul>
        {doc.discounts.map((d, i) => (
          <li key={i} className="wd-num">
            {t.discountKinds[d.kind]}
            {d.label ? `: ${d.label}` : ""} · {moneyText(-d.grossMinor, doc.currency, locale)}
          </li>
        ))}
      </ul>
    </section>
  );
}

function Deferred({ doc, t }: { doc: OrderInvoiceSnapshot; t: DocumentText }) {
  if (doc.deferred.length === 0) return null;
  return (
    <section className="wd-block" aria-label={t.deferredTitle}>
      <h2>{t.deferredTitle}</h2>
      <ul>
        {doc.deferred.map((d) => (
          <li key={d.lineId} className="wd-lines">
            {d.title}
          </li>
        ))}
      </ul>
      <p className="wd-muted">{t.deferredNote}</p>
    </section>
  );
}

function Position({ doc, t, locale }: { doc: CreditNoteSnapshot; t: DocumentText; locale: string }) {
  const money = (minor: number) => moneyText(minor, doc.currency, locale);
  const p = doc.position;
  return (
    <section className="wd-block wd-position" aria-label={t.position.invoiceTotal}>
      <dl>
        <dt>{t.position.invoiceTotal}</dt>
        <dd>{money(p.invoiceTotalMinor)}</dd>
        <dt>{t.position.creditedBefore}</dt>
        <dd>{money(p.creditedBeforeMinor)}</dd>
        <dt>{t.position.creditedNow}</dt>
        <dd>{money(p.creditedNowMinor)}</dd>
        <dt className="wd-strong">{t.position.leftOnInvoice}</dt>
        <dd className="wd-strong">{money(p.leftOnInvoiceMinor)}</dd>
      </dl>
    </section>
  );
}

/**
 * The invoice or credit note of `snapshot`, in its own language (the order's, never the viewer's). The snapshot is trusted as the database
 * wrote it; a shape that does not fit draws what it can rather than failing the page.
 */
export function OrderDocumentView({ snapshot }: { snapshot: OrderInvoiceSnapshot | CreditNoteSnapshot }) {
  const doc = snapshot;
  const t = documentText(doc.language);
  const locale = printLocale(doc.locale);
  const credit = isCredit(doc);
  const title = `${credit ? t.creditNote : t.invoice} ${doc.number}`;
  const footer = doc.seller.footerNote?.trim();
  return (
    <article className="wd" lang={doc.language} aria-label={title} data-document={doc.documentType}>
      <style>{DOCUMENT_CSS + EXTRA_CSS}</style>
      <Head doc={doc} t={t} locale={locale} />
      <div className="wd-parties">
        <Seller doc={doc} t={t} locale={locale} />
        <Buyer doc={doc} t={t} locale={locale} />
      </div>
      {credit && (
        <section className="wd-block" aria-label={t.refersTo(doc.refersTo.invoiceNumber, dayText(doc.refersTo.invoiceIssuedOn, locale))}>
          <p className="wd-strong">{t.refersTo(doc.refersTo.invoiceNumber, dayText(doc.refersTo.invoiceIssuedOn, locale))}</p>
          <p className="wd-muted">{doc.reason.kind === "return" && doc.reason.returnNumber ? t.reasonReturn(doc.reason.returnNumber) : t.reasonRefund}</p>
        </section>
      )}
      {credit ? <CreditLines doc={doc} t={t} locale={locale} /> : <InvoiceLines doc={doc} t={t} locale={locale} />}
      <div className="wd-bottom">
        {!hidesVat(doc) && <VatByRate doc={doc} t={t} locale={locale} sign={credit ? -1 : 1} />}
        <Totals doc={doc} t={t} locale={locale} sign={credit ? -1 : 1} />
      </div>
      <Statements doc={doc} t={t} lang={doc.language} />
      {credit ? (
        <>
          <Position doc={doc} t={t} locale={locale} />
          {doc.notes.includes("credit_capped") && (
            <section className="wd-block wd-notes" aria-label={t.creditCapped}>
              <p>{t.creditCapped}</p>
            </section>
          )}
        </>
      ) : (
        <>
          <Payments doc={doc} t={t} locale={locale} />
          <Discounts doc={doc} t={t} locale={locale} />
          <Deferred doc={doc} t={t} />
          <section className="wd-block wd-notes" aria-label={t.supplyDate}>
            <ul>
              <li>{paidOnline(doc) ? t.supplyDateNote : t.supplyDateNoteVenue}</li>
              {doc.notes.includes("unit_price_rounded") && <li>{t.unitRounded}</li>}
            </ul>
          </section>
        </>
      )}
      {footer && <footer className="wd-footer wd-lines">{footer}</footer>}
    </article>
  );
}
