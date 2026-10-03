import type { LineRight, QuantityProblem, Refusal, WithdrawalWindow } from "./withdrawal";

/**
 * The withdrawal function's page (D153, `docs/returns.md`): what its form sends, what its action answers and how that is
 * read back, as plain data the browser and the server share. The action (`withdraw/actions.ts`) is thin; the rules are in
 * `src/server/withdrawals.ts`. Pure: no database, no cookie, no storage.
 *
 * The form is one `<form>` whose button says what it does (`intent`): `start` (step 1), `confirm` (step 2, the legal act),
 * `edit` (back from step 2 to the lines) and `return` (a request inside the store's own window).
 */

export const INTENTS = ["start", "confirm", "edit", "return"] as const;
export type Intent = (typeof INTENTS)[number];
export const isIntent = (value: unknown): value is Intent => typeof value === "string" && (INTENTS as readonly string[]).includes(value);

/** The form's field names: one place, so the markup and the action agree. */
export const FIELD = {
  intent: "intent",
  name: "name",
  email: "email",
  orderNumber: "orderNumber",
  orderKey: "orderKey",
  /** Present when the shopper was shown the order's lines: a form with none declares everything that can be withdrawn. */
  linesShown: "linesShown",
  requestId: "requestId",
  reason: "reason",
  note: "note",
} as const;

/** `take:{lineId}` ticks a line, `qty:{lineId}` is how many; `rtake`/`rqty` are the return request's; `pick:{lineId}` carries step 2's lines back. */
export const lineField = (kind: "take" | "qty" | "rtake" | "rqty" | "pick", lineId: string) => `${kind}:${lineId}`;

type Entries = Iterable<[string, FormDataEntryValue]>;

const text = (entries: Entries, name: string): string => {
  for (const [key, value] of entries) if (key === name) return typeof value === "string" ? value : "";
  return "";
};

/** What was typed in the identifying fields, trimmed. */
export type Values = { name: string; email: string; orderNumber: string };

export function valuesOf(entries: Entries): Values {
  const all = [...entries];
  return {
    name: text(all, FIELD.name).trim(),
    email: text(all, FIELD.email).trim(),
    orderNumber: text(all, FIELD.orderNumber).trim(),
  };
}

export const orderKeyOf = (entries: Entries): string | null => text([...entries], FIELD.orderKey).trim() || null;

/**
 * The lines the shopper ticked with the number of each: `take:{id}` (any value but off) with `qty:{id}` beside it (`rtake` and
 * `rqty` for the return request). A ticked line with no readable number is declared as 0, so the input's own check says it
 * is not a quantity.
 */
export function declaredLines(entries: Entries, kind: "take" | "rtake" = "take"): { lineId: string; quantity: number }[] {
  const all = [...entries];
  const qty = kind === "take" ? "qty" : "rqty";
  const out: { lineId: string; quantity: number }[] = [];
  for (const [key, value] of all) {
    if (!key.startsWith(`${kind}:`) || value === "off" || value === "") continue;
    const lineId = key.slice(kind.length + 1);
    out.push({ lineId, quantity: wholeNumber(text(all, `${qty}:${lineId}`)) });
  }
  return out;
}

/** The lines step 2 carries back to the form: `pick:{id}` is the number declared. */
export function pickedLines(entries: Entries): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [key, value] of entries) if (key.startsWith("pick:") && typeof value === "string") out[key.slice(5)] = wholeNumber(value);
  return out;
}

const wholeNumber = (raw: string): number => (/^\d{1,6}$/.test(raw.trim()) ? Number(raw.trim()) : 0);

// ---------------------------------------------------------------------------
// What the action answers
// ---------------------------------------------------------------------------

/** One line of the order as the shopper sees it: what it is, what can be done with it, and if nothing, why. */
export type OrderLineInfo = {
  lineId: string;
  title: string;
  /** Units bought. */
  quantity: number;
  right: LineRight;
  /** The most that can be declared now. */
  max: number;
  refusal: Refusal | null;
  exclusion: string | null;
  /** Sealed goods: the right applies while the seal is unbroken (the page says so). */
  sealed: boolean;
};

/** The order as the form needs it. Nothing about money, addresses or other people. */
export type OrderInfo = {
  number: string;
  storeName: string;
  contactEmail: string | null;
  window: Pick<WithdrawalWindow, "state" | "basis" | "statutoryEndDay" | "voluntaryEndDay">;
  right: LineRight;
  subscription: boolean;
  timeZone: string;
  lines: OrderLineInfo[];
};

/** The form's own view of the server's order: only what is shown. */
export function orderInfoOf(view: {
  number: string;
  storeName: string;
  contactEmail: string | null;
  window: Pick<WithdrawalWindow, "state" | "basis" | "statutoryEndDay" | "voluntaryEndDay">;
  right: LineRight;
  subscription: boolean;
  timeZone: string;
  lines: { lineId: string; title: string; quantity: number; right: LineRight; maxQuantity: number; refusal: Refusal | null; exclusion: string | null; sealed: boolean }[];
}): OrderInfo {
  return {
    number: view.number,
    storeName: view.storeName,
    contactEmail: view.contactEmail,
    window: { state: view.window.state, basis: view.window.basis, statutoryEndDay: view.window.statutoryEndDay, voluntaryEndDay: view.window.voluntaryEndDay },
    right: view.right,
    subscription: view.subscription,
    timeZone: view.timeZone,
    lines: view.lines.map((l) => ({
      lineId: l.lineId,
      title: l.title,
      quantity: l.quantity,
      right: l.right,
      max: l.maxQuantity,
      refusal: l.refusal,
      exclusion: l.exclusion,
      sealed: l.sealed,
    })),
  };
}

/** The codes the shopper inputs fail with (`return-input.ts`), by the field they belong to. */
export type FieldKey = "name" | "email" | "orderNumber" | "lines" | "reason" | "note";
export type FieldErrors = Partial<Record<FieldKey, string>>;

const FIELD_OF: Record<string, FieldKey> = {
  name: "name",
  email: "email",
  orderNumber: "orderNumber",
  lines: "lines",
  reason: "reason",
  note: "note",
};

/** The first code of each field out of a validation's problems (`lines.0.quantity` belongs to `lines`). */
export function fieldErrorsOf(problems: readonly { path: string; code: string }[]): FieldErrors {
  const errors: FieldErrors = {};
  for (const problem of problems) {
    const key = FIELD_OF[problem.path.split(".")[0]];
    if (key && !errors[key]) errors[key] = problem.code;
  }
  return errors;
}

/** Why a form is shown again with a sentence over it. */
export type Notice = "unmatched" | "limited" | "nothing" | "failed" | "lapsed" | "not_available" | "quantity";

export type RequestInfo = {
  id: string;
  expiresAt: string;
  orderNumber: string;
  lines: { lineId: string; title: string; quantity: number }[];
};

export type DoneInfo = {
  requestId: string;
  orderNumber: string;
  confirmedAt: string;
  /** The last store day (`YYYY-MM-DD`) to send the goods back. */
  sendBackBy: string;
  /** The latest moment the store may refund. */
  refundBy: string;
  timeZone: string;
  reference: string | null;
  sent: boolean;
  /** Where the acknowledgement went: the order's own address. */
  email: string;
  /** Withdrawn before the goods were sent: there is nothing to send back and no refund is held for the goods. */
  nothingSent: boolean;
  /** The acknowledgement as plain text, in the order's language. */
  text: string | null;
  returns: { number: string; token: string }[];
};

export type WithdrawState =
  | {
      phase: "form";
      values: Values;
      orderKey: string | null;
      /** The order's lines, when the visitor has shown the order is theirs. */
      order: OrderInfo | null;
      /** What is ticked, by line: a form shown again keeps the shopper's numbers. */
      picked: Record<string, number> | null;
      errors: FieldErrors;
      notice: Notice | null;
      /** A return request already made from this page. */
      returned: { number: string; token: string } | null;
      /** Counts every answer, so a screen reader and the focus follow a new one even when it looks like the last. */
      serial: number;
    }
  | {
      phase: "confirm";
      values: Values;
      orderKey: string | null;
      order: OrderInfo;
      request: RequestInfo;
      serial: number;
    }
  | { phase: "done"; values: Values; done: DoneInfo; serial: number };

export type FormState = Extract<WithdrawState, { phase: "form" }>;

export function emptyForm(values: Partial<Values> = {}, orderKey: string | null = null, order: OrderInfo | null = null): FormState {
  return {
    phase: "form",
    values: { name: values.name ?? "", email: values.email ?? "", orderNumber: values.orderNumber ?? "" },
    orderKey,
    order,
    picked: null,
    errors: {},
    notice: null,
    returned: null,
    serial: 0,
  };
}

/** Every line that can be withdrawn, in full: what a statement with no line chosen declares. */
export const withdrawableLines = (order: Pick<OrderInfo, "lines">): { lineId: string; quantity: number }[] =>
  order.lines.filter((l) => l.right === "withdrawal" && l.max > 0).map((l) => ({ lineId: l.lineId, quantity: l.max }));

/** The lines the store's own window takes back, for the return request. */
export const returnableLines = (order: Pick<OrderInfo, "lines">): OrderLineInfo[] => order.lines.filter((l) => l.right === "return" && l.max > 0);

/** A server's quantity problem as the one sentence the form shows. */
export const quantityNotice = (problems: readonly QuantityProblem[]): Notice => (problems.length > 0 ? "quantity" : "nothing");

/** The key a refusal's text is under, or null for a reason a person wrote (a declined line's own words). */
export function refusalCode(value: string | null): Refusal | null {
  const codes: readonly string[] = ["order_not_paid", "copied_order", "already_returned", "excluded_by_law", "digital_content", "booking", "business_order", "period_over"];
  return value !== null && codes.includes(value) ? (value as Refusal) : null;
}
