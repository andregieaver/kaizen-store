"use server";

import { withdrawalStart } from "@/lib/return-input";
import {
  declaredLines,
  emptyForm,
  fieldErrorsOf,
  FIELD,
  isIntent,
  orderInfoOf,
  orderKeyOf,
  pickedLines,
  quantityNotice,
  valuesOf,
  withdrawableLines,
  type FormState,
  type Notice,
  type OrderInfo,
  type Values,
  type WithdrawState,
} from "@/lib/withdraw-form";
import { getCustomer } from "@/server/customers";
import { resolveAfterSaleShop } from "@/server/shop";
import {
  DELAY_FLOOR_MS,
  confirmWithdrawal,
  lookupWithdrawableOrder,
  startReturnRequest,
  startWithdrawal,
  type Problem,
} from "@/server/withdrawals";

/**
 * The withdrawal function's one action (D153, `docs/returns.md`): thin, it reads the form, calls the server module and
 * answers with the state the page draws. The button pressed says what it is (`intent`): `start` (step 1), `confirm` (step 2,
 * the legal act), `edit` (back to the lines) and `return` (a request inside the store's own window).
 *
 * What a stranger can tell apart is only what the server module lets through: a statement that matches no order, and one
 * that does, take the same time (a floor applied over both calls) and a mismatch of any kind is the same `unmatched` answer.
 * No cookie is set and nothing is stored in the browser; the only cookie read is the signed-in customer's own.
 */

const problemsOf = (error: { issues: { path: PropertyKey[]; message: string }[] }): Problem[] =>
  error.issues.map((issue) => ({ path: issue.path.join("."), code: issue.message }));

async function settle<T>(startedAt: number, value: T): Promise<T> {
  const wait = DELAY_FLOOR_MS - (Date.now() - startedAt);
  if (wait > 0) await new Promise<void>((resolve) => setTimeout(resolve, wait));
  return value;
}

export async function withdrawAction(storeSlug: string, marketSlug: string, previous: WithdrawState, form: FormData): Promise<WithdrawState> {
  const startedAt = Date.now();
  const serial = previous.serial + 1;
  const entries = [...form.entries()];
  const values: Values = valuesOf(entries);
  const orderKey = orderKeyOf(entries);
  const intent = String(form.get(FIELD.intent) ?? "");

  const again = (patch: Partial<Omit<FormState, "phase">> = {}): FormState => ({ ...emptyForm(values, orderKey), ...patch, serial });
  const shop = await resolveAfterSaleShop(storeSlug, marketSlug);
  if (!shop || !isIntent(intent)) return again({ notice: "failed" });
  const { store } = shop;

  const customer = await getCustomer(store.id);
  const customerId = customer?.id ?? null;
  // A signed-in customer's own orders need no email: theirs fills the field.
  if (!values.email && customer) values.email = customer.email;
  const lookup = async (): Promise<OrderInfo | null> => {
    const view = await lookupWithdrawableOrder(store.id, { orderNumber: values.orderNumber, email: values.email, orderKey }, { customerId, floorMs: 0 });
    return view ? orderInfoOf(view) : null;
  };
  const shown = previous.phase === "form" || previous.phase === "confirm" ? previous.order : null;
  const returnedBefore = previous.phase === "form" ? previous.returned : null;

  if (intent === "confirm") {
    const outcome = await confirmWithdrawal(store.id, { requestId: String(form.get(FIELD.requestId) ?? "") });
    if (outcome.ok) {
      return {
        phase: "done",
        values,
        serial,
        done: {
          requestId: outcome.requestId,
          orderNumber: outcome.orderNumber,
          confirmedAt: outcome.confirmedAt,
          sendBackBy: outcome.sendBackBy,
          refundBy: outcome.refundBy,
          timeZone: store.timeZone,
          reference: outcome.acknowledgement.reference,
          sent: outcome.acknowledgement.sent,
          // The acknowledgement goes to the order's own address, which is what the page names.
          email: outcome.acknowledgement.to ?? values.email,
          nothingSent: outcome.nothingSent,
          text: outcome.acknowledgement.text,
          returns: outcome.returns.map((r) => ({ number: r.number, token: r.token })),
        },
      };
    }
    const notice: Notice = outcome.code === "lapsed" ? "lapsed" : outcome.code === "not_available" ? "not_available" : "failed";
    // What can still be withdrawn is shown again, so the shopper does not start from nothing.
    const order = notice === "failed" ? null : await lookup();
    return settle(startedAt, again({ notice, order }));
  }

  if (intent === "edit") {
    const order = await lookup();
    return settle(startedAt, order ? again({ order, picked: pickedLines(entries) }) : again({ notice: "unmatched" }));
  }

  if (intent === "return") {
    const reason = String(form.get(FIELD.reason) ?? "").trim();
    const outcome = await startReturnRequest(
      store.id,
      {
        orderNumber: values.orderNumber,
        email: values.email,
        name: values.name,
        lines: declaredLines(entries, "rtake"),
        reason: reason || undefined,
        note: String(form.get(FIELD.note) ?? ""),
        orderKey: orderKey ?? undefined,
      },
      { customerId, floorMs: 0 },
    );
    if (!outcome.ok) {
      return outcome.reason === "invalid"
        ? again({ order: shown, errors: fieldErrorsOf(outcome.problems) })
        : settle(startedAt, again({ order: shown, notice: "limited" }));
    }
    if (!outcome.matched) return settle(startedAt, again({ notice: "unmatched" }));
    const order = orderInfoOf(outcome.order);
    return settle(
      startedAt,
      outcome.created
        ? again({ order, returned: { number: outcome.created.number, token: outcome.created.token } })
        : again({ order, notice: quantityNotice(outcome.problems), returned: returnedBefore }),
    );
  }

  // Step 1: the statement.
  const linesShown = form.get(FIELD.linesShown) === "1";
  let declared = declaredLines(entries);
  let order: OrderInfo | null = null;
  if (!linesShown) {
    // No lines were shown yet (the order is not proven): the fields are checked, then the order is found, and everything
    // that can be withdrawn is declared. The next page lists it and offers to change it.
    const identity = withdrawalStart.pick({ orderNumber: true, email: true, name: true }).safeParse(values);
    if (!identity.success) return again({ errors: fieldErrorsOf(problemsOf(identity.error)) });
    order = await lookup();
    if (!order) return settle(startedAt, again({ notice: "unmatched" }));
    declared = withdrawableLines(order);
    if (declared.length === 0) return settle(startedAt, again({ order, notice: "nothing" }));
  }

  const outcome = await startWithdrawal(
    store.id,
    { orderNumber: values.orderNumber, email: values.email, name: values.name, lines: declared, orderKey: orderKey ?? undefined },
    { customerId, floorMs: 0 },
  );
  if (!outcome.ok) {
    return outcome.reason === "invalid"
      ? again({ order: shown, errors: fieldErrorsOf(outcome.problems), picked: linesShown ? Object.fromEntries(declared.map((l) => [l.lineId, l.quantity])) : null })
      : settle(startedAt, again({ order: shown, notice: "limited" }));
  }
  if (!outcome.matched) return settle(startedAt, again({ notice: "unmatched" }));
  const info = orderInfoOf(outcome.order);
  if (!outcome.request) {
    return settle(
      startedAt,
      again({ order: info, notice: quantityNotice(outcome.problems), picked: Object.fromEntries(declared.map((l) => [l.lineId, l.quantity])) }),
    );
  }
  return settle(startedAt, {
    phase: "confirm",
    values,
    orderKey,
    order: info,
    serial,
    request: {
      id: outcome.request.id,
      expiresAt: outcome.request.expiresAt,
      orderNumber: outcome.request.orderNumber,
      lines: outcome.request.lines.map((l) => ({ lineId: l.lineId, title: l.title, quantity: l.quantity })),
    },
  });
}
