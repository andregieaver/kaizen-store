"use client";

import Link from "next/link";
import { useActionState, useState } from "react";

import { ActionForm, SubmitButton, type FormState } from "@/components/admin/action-form";
import { fillWords } from "@/lib/admin-fill";
import { ADMIN_LANG_FACTS } from "@/lib/admin-lang";
import { formatMoney } from "@/lib/money";
import type { StaffRequestKind } from "@/lib/support-actions";
import type { CarryOut } from "@/lib/support-carry-out";
import type { ConversationRequest, RequestChoice } from "@/server/support-carry-out";

import { useAdminLang, useAdminText } from "../admin-text";

/**
 * A request's actions where it is read (ecosystem plan E2.7, D713): *Carry it out* for a person who may change orders, when the order page's
 * own function would do it now (a cancellation, an address change, a refund), else why not; then Done and Decline, with a note for the
 * customer. The same on the Requests page and above the inbox's reply box. Money that leaves is asked first, naming the amount and the order.
 */

/** A request's bound action: the carry-out, or the decision. */
export type RequestAct = (state: FormState, form: FormData) => Promise<FormState>;

const idle: FormState = { status: "idle", messages: [] };

export function RequestActions({
  request,
  choice,
  base,
  carryOut,
  decide,
  onDone,
}: {
  request: { id: string; kind: StaffRequestKind; orderNumber: string | null; orderId: string | null };
  choice: RequestChoice | null;
  /** The store's admin address, `/admin/{store}`. */
  base: string;
  carryOut: RequestAct | null;
  decide: RequestAct | null;
  /** Told once the request is carried out or decided, with the line that says so. */
  onDone?: (message: string) => void;
}) {
  const w = useAdminText("support").requests;
  const [done, setDone] = useState<string | null>(null);
  const settled = (state: FormState, fallback: string): FormState => {
    if (state.status === "ok") {
      const message = state.messages[0] ?? fallback;
      setDone(message);
      onDone?.(message);
    }
    return state;
  };
  if (done) {
    return (
      <p role="status" className="text-sm">
        {done}
      </p>
    );
  }
  const offered = choice?.carryOut && carryOut ? choice.carryOut : null;
  return (
    <div className="flex flex-col gap-3">
      {choice && request.orderId && <p className="text-xs text-muted">{choice.verified ? w.carry.verified : w.carry.notVerified}</p>}
      {choice?.why && (
        <p className="text-sm text-muted">
          {w.carry.why[choice.why]}
          {request.orderId && (
            <>
              {" "}
              <Link href={`${base}/orders/${request.orderId}`} className="rounded-pill underline">
                {w.carry.openOrder}
              </Link>
            </>
          )}
        </p>
      )}
      {offered && choice && carryOut && (
        <CarryOutForm
          kind={offered}
          number={request.orderNumber ?? ""}
          choice={choice}
          action={async (state, form) => settled(await carryOut(state, form), w.done)}
        />
      )}
      {decide && (
        <ActionForm action={async (state, form) => settled(await decide(state, form), w.done)} className="flex flex-col gap-2">
          <details className="text-sm">
            <summary className="cursor-pointer text-ink underline underline-offset-2">{w.carry.addNote}</summary>
            <label className="mt-2 flex flex-col gap-1">
              {w.note}
              <textarea name="note" maxLength={500} rows={2} className="rounded-panel border border-line bg-card px-3 py-2" />
            </label>
          </details>
          <div className="flex flex-wrap gap-2">
            <SubmitButton name="decision" value="done" variant={offered ? "secondary" : "primary"}>
              {w.done}
            </SubmitButton>
            <SubmitButton name="decision" value="declined" variant="secondary">
              {w.decline}
            </SubmitButton>
          </div>
          {!offered && <p className="text-xs text-muted">{w.help}</p>}
        </ActionForm>
      )}
    </div>
  );
}

/** One line of an address, as the customer gave it. */
const addressLine = (a: NonNullable<RequestChoice["address"]>) => [a.name, a.line1, a.line2, `${a.postalCode} ${a.city}`].filter(Boolean).join(", ");

/**
 * *Carry it out* for one kind. A refund is everything left (the amount shown is sent back, so a figure that moved is refused) or a part typed
 * in the order's currency, to the original payment or as store credit, as on the order page; every kind asks first in words.
 */
function CarryOutForm({ kind, number, choice, action }: { kind: CarryOut; number: string; choice: RequestChoice; action: RequestAct }) {
  const w = useAdminText("support").requests.carry;
  const locale = ADMIN_LANG_FACTS[useAdminLang()].locale;
  const [state, formAction, pending] = useActionState(action, idle);
  const [whole, setWhole] = useState(true);
  const [part, setPart] = useState("");
  const money = choice.money;
  const shown = money ? formatMoney(money.minor, money.currency, locale) : "";
  const named = whole ? shown : `${money?.currency ?? ""} ${part.trim()}`.trim();
  const address = choice.address ? addressLine(choice.address) : "";
  const free = !money || money.minor <= 0;
  const question =
    kind === "cancel"
      ? free
        ? fillWords(w.confirmCancelFree, { number })
        : fillWords(w.confirmCancel, { number, amount: shown })
      : kind === "address"
        ? fillWords(w.confirmAddress, { number, address })
        : fillWords(w.confirmRefund, { amount: named, number });
  const label = kind === "cancel" ? fillWords(w.cancel, { number }) : kind === "address" ? w.address : fillWords(w.refund, { amount: named });
  return (
    <form
      action={formAction}
      onSubmit={(event) => {
        if (!window.confirm(question)) event.preventDefault();
      }}
      className="flex flex-col gap-2"
      aria-busy={pending}
    >
      {money && <input type="hidden" name="expectMinor" value={money.minor} />}
      {kind === "cancel" && <p className="text-sm">{free ? w.cancelSaysFree : fillWords(w.cancelSays, { amount: shown })}</p>}
      {kind === "address" && <p className="text-sm">{fillWords(w.addressSays, { address })}</p>}
      {kind === "refund" && (
        <>
          <input type="hidden" name="howMuch" value={whole ? "all" : "part"} />
          <fieldset className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
            <legend className="sr-only">{fillWords(w.amount, { currency: money?.currency ?? "" })}</legend>
            <label className="flex items-center gap-2">
              <input type="radio" name="howMuchChoice" checked={whole} onChange={() => setWhole(true)} className="size-4" />
              {w.everything} ({shown})
            </label>
            <label className="flex items-center gap-2">
              <input type="radio" name="howMuchChoice" checked={!whole} onChange={() => setWhole(false)} className="size-4" />
              {w.partOfIt}
            </label>
          </fieldset>
          {!whole && (
            <label className="flex flex-col gap-1 text-sm">
              {fillWords(w.amount, { currency: money?.currency ?? "" })}
              <input
                name="amount"
                inputMode="decimal"
                value={part}
                onChange={(event) => setPart(event.target.value)}
                placeholder={w.typeAmount}
                className="min-h-10 w-40 rounded-md border border-line bg-card px-3 text-sm"
              />
            </label>
          )}
          <fieldset className="flex flex-col gap-1 text-sm">
            <legend className="mb-1">{w.refundTo}</legend>
            <label className="flex items-center gap-2">
              <input type="radio" name="refundTo" value="payment" defaultChecked className="size-4" />
              {w.toPayment}
            </label>
            <label className="flex items-start gap-2">
              <input type="radio" name="refundTo" value="credit" className="mt-0.5 size-4" />
              <span>
                {w.toCredit}
                <span className="block text-xs text-muted">{w.creditHint}</span>
              </span>
            </label>
          </fieldset>
          <p className="text-xs text-muted">{w.refundSays}</p>
        </>
      )}
      <button
        type="submit"
        disabled={pending || (kind === "refund" && !whole && !part.trim())}
        className="min-h-10 self-start rounded-pill bg-inverse px-4 text-sm font-medium text-inverse-ink disabled:opacity-50"
      >
        {pending ? w.working : label}
      </button>
      {state.status === "error" && (
        <p role="alert" className="text-sm text-danger-text">
          {state.messages[0]}
        </p>
      )}
    </form>
  );
}

/**
 * A conversation's open requests above the reply box (ecosystem plan E2.7): what was asked, its order linked, and the request's actions for a
 * person who may decide them; elsewhere (the owner's level) a link to the store's Requests page. Nothing while none is open.
 */
export function ConversationRequests({
  store,
  requests,
  acts,
  onDone,
}: {
  store: { slug: string } | null;
  requests: ConversationRequest[] | undefined;
  /** The store's bound actions, taking the request first; null where the inbox has none (the owner's level, or a reader). */
  acts: { carryOut: ((id: string, state: FormState, form: FormData) => Promise<FormState>) | null; decide: (id: string, state: FormState, form: FormData) => Promise<FormState> } | null;
  onDone: () => void;
}) {
  const w = useAdminText("support").requests;
  const [notice, setNotice] = useState<string | null>(null);
  const open = requests ?? [];
  if (!store || (open.length === 0 && !notice)) return null;
  const base = `/admin/${store.slug}`;
  return (
    <section aria-label={w.carry.title} className="flex max-h-[45vh] flex-col gap-2 overflow-y-auto border-t border-line bg-sunken px-4 py-3">
      {notice && (
        <p role="status" className="text-sm">
          {notice}
        </p>
      )}
      {open.length > 0 && <h3 className="text-caption text-muted">{w.carry.title}</h3>}
      {open.map((r, i) => (
        <details key={r.id} open={i === 0} className="rounded-panel bg-card px-3 py-2">
          <summary className="cursor-pointer text-sm">
            <span className="font-medium">{w.kinds[r.kind]}</span>
            {r.orderNumber && ` · ${fillWords(w.order, { number: r.orderNumber })}`}
          </summary>
          <div className="mt-2 flex flex-col gap-2">
            {r.details && (
              <p className="text-sm">
                <span className="text-muted">{w.aiWrote} </span>
                {r.details}
              </p>
            )}
            <p className="text-sm text-muted">
              {fillWords(w.customerSees, { text: r.summary })}
              {r.orderId && (
                <>
                  {" · "}
                  <Link href={`${base}/orders/${r.orderId}`} className="rounded-pill underline">
                    {fillWords(w.order, { number: r.orderNumber ?? "" })}
                  </Link>
                </>
              )}
            </p>
            {acts ? (
              <RequestActions
                request={r}
                choice={r.choice}
                base={base}
                carryOut={acts.carryOut ? (state, form) => acts.carryOut!(r.id, state, form) : null}
                decide={(state, form) => acts.decide(r.id, state, form)}
                onDone={(message) => {
                  setNotice(message);
                  onDone();
                }}
              />
            ) : (
              <Link href={`${base}/support/requests`} className="rounded-pill text-sm underline">
                {w.carry.decidePage}
              </Link>
            )}
          </div>
        </details>
      ))}
    </section>
  );
}
