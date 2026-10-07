/**
 * What the order page's *Send* card sends for a parcel (wave 3, run 3, D174, `docs/wave-3-fulfilment.md` 2.1): one number field `qty:{lineId}` per physical line
 * that has units to send, and `parcel=lines` to say the staff member chose. Without `parcel=lines` (a weekly box, which is sent whole, or a form from before parcels
 * named their lines) the parcel is "everything still to send" (`null`). Pure; the server checks the parcel again under the order's lock (`markSent()`,
 * `shipmentProblems()`): this only reads the form.
 */
import type { ParcelLine } from "./fulfilment";

const LINE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** A form never names more lines than an order has; this only stops a crafted request from making the server read thousands. */
const MAX_LINES = 500;

type FormLike = { get(name: string): FormDataEntryValue | null; keys(): IterableIterator<string> | Iterable<string> };

/** The parcel's lines, `null` for everything still to send, or `invalid` for a quantity that is not a whole number of 0 or more. Lines at 0 are kept (the server leaves them out). */
export function parcelLinesFromForm(form: FormLike): ParcelLine[] | null | "invalid" {
  if (form.get("parcel") !== "lines") return null;
  const lines: ParcelLine[] = [];
  for (const key of form.keys()) {
    if (!key.startsWith("qty:")) continue;
    const lineId = key.slice(4);
    if (!LINE_ID.test(lineId)) return "invalid";
    if (lines.some((l) => l.lineId === lineId.toLowerCase())) continue;
    const raw = String(form.get(key) ?? "").trim();
    if (!/^\d{1,6}$/.test(raw)) return "invalid";
    lines.push({ lineId: lineId.toLowerCase(), quantity: Number(raw) });
    if (lines.length > MAX_LINES) return "invalid";
  }
  return lines;
}

/**
 * A carrier booking's parcel (D174 2.1: Bring, Porterbuddy and Helthjem take the same *In this parcel* choice as the *Send* card). `typed` is each line's number as typed,
 * by line id; a line not typed keeps all its units still to send. `null` when every line goes whole (everything still to send: the booking's meaning before parcels named
 * their lines), `invalid` for a number that is not a whole number from 0 to what is left of its line, else the chosen lines (0 kept; the server leaves those out).
 */
export function parcelLinesFromChoice(rows: readonly { lineId: string; toSend: number }[], typed: Readonly<Record<string, string>>): ParcelLine[] | null | "invalid" {
  const open = rows.filter((r) => r.toSend > 0);
  const lines: ParcelLine[] = [];
  let whole = true;
  for (const row of open) {
    const raw = (typed[row.lineId] ?? String(row.toSend)).trim();
    if (!/^\d{1,6}$/.test(raw)) return "invalid";
    const quantity = Number(raw);
    if (quantity > row.toSend) return "invalid";
    if (quantity !== row.toSend) whole = false;
    lines.push({ lineId: row.lineId, quantity });
  }
  return whole ? null : lines;
}

/** The units a parcel choice holds (all still to send when it is `null`). */
export function unitsInChoice(rows: readonly { toSend: number }[], lines: readonly ParcelLine[] | null): number {
  return lines === null ? rows.reduce((sum, r) => sum + r.toSend, 0) : lines.reduce((sum, l) => sum + l.quantity, 0);
}
