/**
 * Which open invoice a client's payment on the bank statement pays (B4 of `docs/own-books-and-sales.md`, D487). Pure: the statement's
 * lines of money in, not yet matched to the books, and the store's open invoices in, the invoice each line most likely pays out, with how
 * sure. An invoice's payment reference is its number (printed on it and in the EHF's PaymentID), so a client's bank writes it in the line;
 * the amount and the client's name say the rest.
 *
 * - `certain`: the invoice's number is in the line, the line pays exactly what is outstanding, and no other open invoice's number is in it.
 *   Recorded as paid when the statement is read.
 * - `number`: the invoice's number is in the line, and the line pays no more than is outstanding (a part payment, or more than one number).
 * - `amount_name`: the line pays exactly what is outstanding on one invoice whose client's name the bank gives.
 * - `amount`: the line pays exactly what is outstanding on one open invoice and on no other.
 *
 * The last three are offered to the owner, one press each. A line is never offered an invoice issued after the money came, nor one in
 * another currency, nor more than is outstanding, nor one that takes no money of its day (`paidFrom`); lines are taken in the order the money came, each taking what it pays off the invoice
 * before the next is looked at.
 */

export type BankMoneyIn = { id: string; day: string; amountMinor: number; currency: string; text: string; reference: string | null; counterparty: string | null };

export type OpenInvoice = {
  id: string;
  /** The number printed on the invoice (its prefix and number, or the number it had before it was imported). */
  printedNumber: string;
  /** Its number in the series, without the prefix, when it has one. */
  number: number | null;
  /** Other numbers it goes by, as printed (a shop's invoice is also its order's number). */
  alsoNamed?: readonly string[];
  /** The first day money may be recorded for it, when there is one (a shop's balance on terms takes money of the last 31 days). */
  paidFrom?: string;
  client: string;
  currency: string;
  issuedOn: string;
  outstandingMinor: number;
};

export type InvoiceMatchKind = "certain" | "number" | "amount_name" | "amount";

export type InvoiceMatch = { lineId: string; invoiceId: string; kind: InvoiceMatchKind };

/** The words and digit runs of a bank line, lower case: `Faktura F-1042 / KID 0012345` gives `faktura`, `f-1042`, `f`, `1042`, … */
function tokensOf(...texts: (string | null)[]): Set<string> {
  const out = new Set<string>();
  for (const text of texts) {
    if (!text) continue;
    const lower = text.toLowerCase();
    for (const t of lower.split(/[\s,;:/()[\]{}"'#*]+/)) {
      const trimmed = t.replace(/^[.\-_]+|[.\-_]+$/g, "");
      if (trimmed) out.add(trimmed);
    }
    for (const digits of lower.match(/\d+/g) ?? []) out.add(digits.replace(/^0+(?=\d)/, ""));
  }
  return out;
}

/** Whether the line names the invoice: its printed number as a word, or its number in the series as a run of digits of its own. */
export function namesInvoice(line: Pick<BankMoneyIn, "text" | "reference">, invoice: Pick<OpenInvoice, "printedNumber" | "number" | "alsoNamed">): boolean {
  const tokens = tokensOf(line.reference, line.text);
  if (invoice.number !== null && invoice.number > 0 && tokens.has(String(invoice.number))) return true;
  for (const name of [invoice.printedNumber, ...(invoice.alsoNamed ?? [])]) {
    const printed = name.trim().toLowerCase();
    if (printed && tokens.has(printed)) return true;
    // A number that is all digits, written with leading zeros or without (an imported invoice's, an order's).
    if (/^\d+$/.test(printed) && tokens.has(printed.replace(/^0+(?=\d)/, ""))) return true;
  }
  return false;
}

const LEGAL_FORMS = new Set(["as", "asa", "enk", "da", "ans", "sa", "nuf", "ab", "aps", "a/s", "oy", "gmbh", "ag", "bv", "nv", "ltd", "limited", "inc", "llc", "plc", "sarl", "srl", "spa"]);

function nameWords(name: string): Set<string> {
  return new Set(
    name
      .toLowerCase()
      // A bank may write a name without the Nordic letters: ø and æ do not fall apart as å does.
      .replace(/ø/g, "o")
      .replace(/æ/g, "ae")
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length >= 3 && !LEGAL_FORMS.has(w)),
  );
}

/** Whether the name the bank gives for the payer, or its words, share a word with the client's name (not a legal form such as AS). */
export function namesClient(line: Pick<BankMoneyIn, "counterparty" | "text">, client: string): boolean {
  const theirs = nameWords(client);
  if (theirs.size === 0) return false;
  const said = nameWords(`${line.counterparty ?? ""} ${line.text}`);
  for (const w of theirs) if (said.has(w)) return true;
  return false;
}

/** For each line of money in, the open invoice it most likely pays, or none (see the module's comment). */
export function matchInvoices(lines: readonly BankMoneyIn[], invoices: readonly OpenInvoice[]): InvoiceMatch[] {
  const left = new Map(invoices.map((i) => [i.id, i.outstandingMinor]));
  const out: InvoiceMatch[] = [];
  const ordered = [...lines].filter((l) => l.amountMinor > 0).sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : a.id < b.id ? -1 : 1));
  for (const line of ordered) {
    const open = invoices.filter((i) => i.currency === line.currency && i.issuedOn <= line.day && (!i.paidFrom || i.paidFrom <= line.day) && (left.get(i.id) ?? 0) > 0);
    const exact = (i: OpenInvoice) => left.get(i.id) === line.amountMinor;
    const fits = (i: OpenInvoice) => line.amountMinor <= (left.get(i.id) ?? 0);
    const named = open.filter((i) => namesInvoice(line, i));
    let pick: { invoice: OpenInvoice; kind: InvoiceMatchKind } | null = null;
    if (named.length === 1 && exact(named[0])) pick = { invoice: named[0], kind: "certain" };
    else if (named.length > 0) {
      const exacts = named.filter(exact);
      const fitting = named.filter(fits);
      if (exacts.length === 1) pick = { invoice: exacts[0], kind: "number" };
      else if (fitting.length === 1) pick = { invoice: fitting[0], kind: "number" };
    }
    if (!pick) {
      const exacts = open.filter(exact);
      const byName = exacts.filter((i) => namesClient(line, i.client));
      if (byName.length === 1) pick = { invoice: byName[0], kind: "amount_name" };
      else if (exacts.length === 1 && byName.length === 0) pick = { invoice: exacts[0], kind: "amount" };
    }
    if (!pick) continue;
    left.set(pick.invoice.id, (left.get(pick.invoice.id) ?? 0) - line.amountMinor);
    out.push({ lineId: line.id, invoiceId: pick.invoice.id, kind: pick.kind });
  }
  return out;
}
