"use client";

import { startTransition, useActionState, useEffect, useRef, type FormEvent } from "react";

import {
  Carried,
  CannotList,
  ConfirmSummary,
  DoneSummary,
  Field,
  INPUT,
  PRIMARY,
  SECONDARY,
  WithdrawLines,
  errorList,
  fieldMessage,
  noticeText,
  windowNote,
} from "@/components/withdraw/withdraw-parts";
import { RETURN_REASONS } from "@/lib/withdrawal";
import { t } from "@/lib/i18n";
import { FIELD, lineField, returnableLines, withdrawableLines, type FormState, type WithdrawState } from "@/lib/withdraw-form";

import { withdrawAction } from "./actions";

/**
 * The withdrawal function's form (D153): *Withdraw from contract here* (step 1), then *Confirm withdrawal* (step 2, the legal
 * act) and the acknowledgement. One `<form>` whose buttons say what they do. Like the admin's `ActionForm` it calls the
 * action from a transition, so a form that fails keeps what was typed. (Like every page that streams, it needs JavaScript to
 * show: the dynamic part of the page arrives out of line.) Focus follows the step: to the message when there is one, else to
 * the new step's heading, and errors are announced (`role="alert"`). No cookie, no storage.
 */
export function WithdrawFlow({
  storeSlug,
  marketSlug,
  lang,
  locale,
  base,
  storeName,
  contactEmail,
  initial,
}: {
  storeSlug: string;
  marketSlug: string;
  lang: string;
  locale: string;
  base: string;
  storeName: string;
  contactEmail: string | null;
  initial: WithdrawState;
}) {
  const m = t(lang).returns;
  const [state, formAction, pending] = useActionState(withdrawAction.bind(null, storeSlug, marketSlug), initial);
  const root = useRef<HTMLDivElement>(null);
  const seen = useRef(state.serial);

  // Focus follows each new answer: to its message, else to its heading. Not on the first render.
  useEffect(() => {
    if (seen.current === state.serial) return;
    seen.current = state.serial;
    root.current?.querySelector<HTMLElement>("[data-focus]")?.focus();
  }, [state]);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const submitter = (event.nativeEvent as SubmitEvent).submitter;
    startTransition(() => formAction(new FormData(event.currentTarget, submitter)));
  };

  const contact = { storeName, email: contactEmail };
  return (
    <div ref={root} className="flex flex-col gap-6">
      {state.phase === "done" ? (
        <section aria-labelledby="withdraw-heading" className="flex flex-col gap-4">
          <h2 id="withdraw-heading" tabIndex={-1} data-focus className="text-2xl font-heading tracking-tight outline-none">
            {m.done.heading}
          </h2>
          <DoneSummary m={m} done={state.done} locale={locale} base={base} />
        </section>
      ) : (
        <form
          key={`${state.phase}:${state.phase === "form" && state.order ? "order" : "none"}`}
          action={formAction}
          onSubmit={submit}
          aria-busy={pending}
          className="flex flex-col gap-5"
        >
          {state.phase === "confirm" ? (
            <Confirm state={state} m={m} pending={pending} />
          ) : (
            <Statement state={state} m={m} locale={locale} base={base} pending={pending} contact={contact} />
          )}
        </form>
      )}
    </div>
  );
}

type R = ReturnType<typeof t>["returns"];

function Confirm({ state, m, pending }: { state: Extract<WithdrawState, { phase: "confirm" }>; m: R; pending: boolean }) {
  return (
    <>
      <div>
        <p className="text-sm text-muted">{m.stepOf(2)}</p>
        <h2 id="withdraw-heading" tabIndex={-1} data-focus className="text-2xl font-heading tracking-tight outline-none">
          {m.checkHeading}
        </h2>
      </div>
      <Carried values={state.values} orderKey={state.orderKey} />
      <input type="hidden" name={FIELD.requestId} value={state.request.id} />
      {/* The lines declared, carried back if the shopper changes them. */}
      {state.request.lines.map((line) => (
        <input key={line.lineId} type="hidden" name={lineField("pick", line.lineId)} value={line.quantity} />
      ))}
      <ConfirmSummary m={m} request={state.request} />
      <div className="flex flex-wrap gap-3">
        <button type="submit" name={FIELD.intent} value="confirm" disabled={pending} className={PRIMARY}>
          {pending ? m.working : m.confirmButton}
        </button>
        <button type="submit" name={FIELD.intent} value="edit" formNoValidate disabled={pending} className={SECONDARY}>
          {m.changeButton}
        </button>
      </div>
    </>
  );
}

function Statement({
  state,
  m,
  locale,
  base,
  pending,
  contact,
}: {
  state: FormState;
  m: R;
  locale: string;
  base: string;
  pending: boolean;
  contact: { storeName: string; email: string | null };
}) {
  const { order, errors, values } = state;
  const errored = errorList(m, errors);
  const notice = state.notice ? noticeText(m, state.notice, contact) : null;
  const canWithdraw = order ? withdrawableLines(order).length > 0 : true;
  const returnable = order ? returnableLines(order) : [];
  const window = order ? windowNote(m, order, locale) : null;
  const headingFocus = errored.length === 0 && !notice;
  return (
    <>
      <div>
        <p className="text-sm text-muted">{m.stepOf(1)}</p>
        <h2 id="withdraw-heading" tabIndex={-1} {...(headingFocus ? { "data-focus": true } : {})} className="text-2xl font-heading tracking-tight outline-none">
          {m.statementHeading}
        </h2>
      </div>

      {errored.length > 0 && (
        <div role="alert" tabIndex={-1} data-focus className="rounded-lg border border-red-700 p-4 text-sm outline-none dark:border-red-400">
          <p className="font-medium">{m.errorsHeading}</p>
          <ul className="list-disc pl-5">
            {errored.map((e) => (
              <li key={e.key}>{e.text}</li>
            ))}
          </ul>
        </div>
      )}
      {notice && (
        <div
          role={notice.urgent ? "alert" : "status"}
          tabIndex={-1}
          data-focus
          className="flex flex-col gap-1 rounded-lg border border-border bg-surface p-4 text-sm outline-none"
        >
          <p className="font-medium">{notice.text}</p>
          {notice.help && <p>{notice.help}</p>}
        </div>
      )}

      <Field name="name" label={m.name} error={fieldMessage(m, errors.name)}>
        {(props) => <input {...props} name={FIELD.name} defaultValue={values.name} required maxLength={120} autoComplete="name" className={INPUT} />}
      </Field>
      <Field name="email" label={m.email} hint={m.emailHint} error={fieldMessage(m, errors.email)}>
        {(props) => (
          <input {...props} name={FIELD.email} type="email" defaultValue={values.email} required maxLength={254} autoComplete="email" spellCheck={false} className={INPUT} />
        )}
      </Field>
      <Field name="orderNumber" label={m.orderNumber} hint={m.orderNumberHint} error={fieldMessage(m, errors.orderNumber)}>
        {(props) => <input {...props} name={FIELD.orderNumber} defaultValue={values.orderNumber} required maxLength={40} autoCapitalize="characters" autoComplete="off" spellCheck={false} className={INPUT} />}
      </Field>
      {state.orderKey && <input type="hidden" name={FIELD.orderKey} value={state.orderKey} />}

      {order && (
        <section aria-label={m.statusOrder(order.number)} className="flex flex-col gap-4">
          {window && <p className="text-sm">{window}</p>}
          {order.subscription && <p className="text-sm text-muted">{m.subscriptionNote}</p>}
          {!canWithdraw && !notice && returnable.length === 0 && <p className="font-medium">{m.nothing}</p>}
          {canWithdraw && <input type="hidden" name={FIELD.linesShown} value="1" />}
          <WithdrawLines m={m} lines={order.lines} picked={state.picked} />
          {errors.lines && <p className="text-sm text-red-700 dark:text-red-400">{fieldMessage(m, errors.lines)}</p>}
          <CannotList m={m} lines={order.lines} />
        </section>
      )}
      {!order && <p className="text-sm text-muted">{m.allIncluded}</p>}

      {canWithdraw && (
        <div>
          <button type="submit" name={FIELD.intent} value="start" disabled={pending} className={PRIMARY}>
            {pending ? m.working : m.startButton}
          </button>
        </div>
      )}

      {order && (returnable.length > 0 || state.returned) && (
        <section aria-labelledby="return-heading" className="flex flex-col gap-4 border-t border-border pt-6">
          <h3 id="return-heading" className="text-xl font-heading tracking-tight">
            {m.returnRequest.heading}
          </h3>
          {state.returned ? (
            <div role="status" className="flex flex-col gap-1">
              <p>{m.returnRequest.sent(state.returned.number)}</p>
              <a href={`${base}/returns/${state.returned.token}`} className="underline">
                {m.returnRequest.track}
              </a>
            </div>
          ) : (
            <>
              <p>{m.returnRequest.intro(order.storeName)}</p>
              <fieldset className="flex flex-col gap-2">
                <legend className="text-sm font-medium">{m.returnRequest.linesHeading}</legend>
                <ul className="divide-y divide-border rounded-lg border border-border px-4">
                  {returnable.map((line) => (
                    <li key={line.lineId} className="flex flex-wrap items-center justify-between gap-3 py-3">
                      <span className="flex min-w-0 flex-1 items-center gap-3">
                        <input type="checkbox" id={`rtake-${line.lineId}`} name={lineField("rtake", line.lineId)} aria-label={m.lineSelect(line.title)} className="size-5 shrink-0" />
                        <label htmlFor={`rtake-${line.lineId}`} className="min-w-0 break-words">
                          {line.title}
                        </label>
                      </span>
                      <span className="flex items-center gap-2 text-sm">
                        <label htmlFor={`rqty-${line.lineId}`} className="sr-only">
                          {m.lineQuantity(line.title)}
                        </label>
                        <input
                          type="number"
                          id={`rqty-${line.lineId}`}
                          name={lineField("rqty", line.lineId)}
                          min={1}
                          max={line.max}
                          step={1}
                          inputMode="numeric"
                          defaultValue={line.max}
                          className="min-h-11 w-20 rounded-md border border-border bg-background px-3"
                        />
                        <span aria-hidden>{m.ofMax(line.max)}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              </fieldset>
              <Field name="reason" label={m.returnRequest.reasonLabel} error={fieldMessage(m, errors.reason)}>
                {(props) => (
                  <select {...props} name={FIELD.reason} defaultValue="" className={INPUT}>
                    <option value="">{m.returnRequest.noReason}</option>
                    {RETURN_REASONS.map((reason) => (
                      <option key={reason} value={reason}>
                        {m.reasons[reason]}
                      </option>
                    ))}
                  </select>
                )}
              </Field>
              <Field name="note" label={m.returnRequest.noteLabel} error={fieldMessage(m, errors.note)}>
                {(props) => <textarea {...props} name={FIELD.note} rows={3} maxLength={500} className={`${INPUT} py-2`} />}
              </Field>
              <p className="text-sm text-muted">{m.returnRequest.defectNote}</p>
              <div>
                <button type="submit" name={FIELD.intent} value="return" disabled={pending} className={SECONDARY}>
                  {pending ? m.working : m.returnRequest.button}
                </button>
              </div>
            </>
          )}
        </section>
      )}
    </>
  );
}
