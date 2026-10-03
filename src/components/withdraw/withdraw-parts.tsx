import type { ReactNode } from "react";

import type { Messages } from "@/lib/i18n";
import { formatDeclaration, formatStoreDay } from "@/lib/return-time";
import {
  FIELD,
  lineField,
  refusalCode,
  type DoneInfo,
  type FieldErrors,
  type FieldKey,
  type Notice,
  type OrderInfo,
  type OrderLineInfo,
  type RequestInfo,
} from "@/lib/withdraw-form";

/**
 * The pieces of the withdrawal function's page (D153, `docs/returns.md`), drawn from plain data so the page, the tests and
 * the status page agree. No hooks and no state: the form that places them is `withdraw/withdraw-flow.tsx`. Every text is
 * `m.returns.*`; nothing here sets a cookie or touches storage.
 */

export type R = Messages["returns"];

export const INPUT = "min-h-11 w-full rounded-md border border-border bg-background px-3";
export const PRIMARY = "button-primary min-h-11 rounded-button px-6 font-medium disabled:opacity-40";
export const SECONDARY = "min-h-11 rounded-button border border-border px-5 disabled:opacity-40";

/** The sentence under a field when its check failed, in the shopper's language, or null. */
export function fieldMessage(m: R, code: string | undefined): string | null {
  if (!code) return null;
  const known = m.fieldErrors as Record<string, string>;
  return known[code] ?? m.failed;
}

/** The sentence a form shown again opens with, and whether it is an error (read at once) or only information. */
export function noticeText(m: R, notice: Notice, contact: { storeName: string; email: string | null }): { text: string; urgent: boolean; help: string | null } {
  const help = contact.email ? m.contactLine(contact.storeName, contact.email) : m.contactStore(contact.storeName);
  switch (notice) {
    case "unmatched":
      // The same words whether or not the details match an order: a stranger learns nothing from them.
      return { text: m.unmatched, urgent: false, help: `${m.unmatchedHelp} ${help}` };
    case "limited":
      return { text: m.limited, urgent: true, help };
    case "nothing":
      return { text: m.nothing, urgent: true, help: null };
    case "lapsed":
      return { text: m.lapsed, urgent: true, help: null };
    case "not_available":
      return { text: m.notAvailable, urgent: true, help: null };
    case "quantity":
      return { text: m.quantityProblem, urgent: true, help: null };
    case "failed":
      return { text: m.failed, urgent: true, help };
  }
}

export function FieldNote({ id, children }: { id: string; children: ReactNode }) {
  return (
    <p id={id} className="text-sm text-muted">
      {children}
    </p>
  );
}

/** A labelled field with its hint and its error, tied to the input for screen readers. */
export function Field({
  name,
  label,
  hint,
  error,
  children,
}: {
  name: string;
  label: string;
  hint?: string;
  error?: string | null;
  children: (props: { id: string; "aria-describedby": string | undefined; "aria-invalid": true | undefined }) => ReactNode;
}) {
  const id = `field-${name}`;
  const described = [hint ? `${id}-hint` : null, error ? `${id}-error` : null].filter(Boolean).join(" ") || undefined;
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      {children({ id, "aria-describedby": described, "aria-invalid": error ? true : undefined })}
      {hint && <FieldNote id={`${id}-hint`}>{hint}</FieldNote>}
      {error && (
        <p id={`${id}-error`} className="text-sm text-red-700 dark:text-red-400">
          {error}
        </p>
      )}
    </div>
  );
}

/** Where the order stands in time, in one sentence. */
export function windowNote(m: R, order: Pick<OrderInfo, "window" | "storeName">, locale: string): string | null {
  const { window } = order;
  switch (window.state) {
    case "before_delivery":
      return m.windowBefore;
    case "statutory":
      // Sent but not yet received: the 14 days start when the goods arrive, so no end day is given (never an estimate).
      return window.statutoryEndDay ? m.windowStatutory(formatStoreDay(window.statutoryEndDay, locale)) : window.basis === "sent" ? m.windowSent : null;
    case "voluntary":
      return window.voluntaryEndDay ? m.windowVoluntary(order.storeName, formatStoreDay(window.voluntaryEndDay, locale)) : null;
    case "closed":
      return m.windowClosed;
  }
}

/** The lines the law gives the right to withdraw from, each with a tick and a number: everything is ticked until the shopper changes it. */
export function WithdrawLines({ m, lines, picked }: { m: R; lines: OrderLineInfo[]; picked: Record<string, number> | null }) {
  const rows = lines.filter((l) => l.right === "withdrawal" && l.max > 0);
  if (rows.length === 0) return null;
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="text-sm font-medium">{m.linesHeading}</legend>
      <p className="text-sm text-muted">{m.linesHint}</p>
      <ul className="divide-y divide-border rounded-lg border border-border px-4">
        {rows.map((line) => (
          <li key={line.lineId} className="flex flex-wrap items-center justify-between gap-3 py-3">
            <span className="flex min-w-0 flex-1 items-center gap-3">
              <input
                type="checkbox"
                id={`take-${line.lineId}`}
                name={lineField("take", line.lineId)}
                defaultChecked={picked ? line.lineId in picked : true}
                aria-label={m.lineSelect(line.title)}
                className="size-5 shrink-0"
              />
              <label htmlFor={`take-${line.lineId}`} className="min-w-0 break-words">
                {line.title}
                {line.sealed && <span className="block text-sm text-muted">{m.sealedLine}</span>}
              </label>
            </span>
            <span className="flex items-center gap-2 text-sm">
              <label htmlFor={`qty-${line.lineId}`} className="sr-only">
                {m.lineQuantity(line.title)}
              </label>
              <input
                type="number"
                id={`qty-${line.lineId}`}
                name={lineField("qty", line.lineId)}
                min={1}
                max={line.max}
                step={1}
                inputMode="numeric"
                defaultValue={Math.min(line.max, picked?.[line.lineId] ?? line.max)}
                className="min-h-11 w-20 rounded-md border border-border bg-background px-3"
              />
              <span aria-hidden>{m.ofMax(line.max)}</span>
            </span>
          </li>
        ))}
      </ul>
    </fieldset>
  );
}

/** What cannot be withdrawn, each with its plain reason: nothing is left out without saying why. */
export function CannotList({ m, lines }: { m: R; lines: OrderLineInfo[] }) {
  const rows = lines.filter((l) => l.right === "none" && l.refusal);
  if (rows.length === 0) return null;
  const exclusions = m.exclusions as Record<string, string>;
  return (
    <section aria-labelledby="cannot-heading" className="flex flex-col gap-2">
      <h3 id="cannot-heading" className="text-sm font-medium">
        {m.cannotHeading}
      </h3>
      <ul className="divide-y divide-border rounded-lg border border-border px-4">
        {rows.map((line) => (
          <li key={line.lineId} className="flex flex-col gap-0.5 py-3">
            <span className="break-words">{line.title}</span>
            <span className="text-sm text-muted">
              {m.refusal[line.refusal!]}
              {line.refusal === "excluded_by_law" && line.exclusion && exclusions[line.exclusion] ? ` (${exclusions[line.exclusion]})` : ""}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Step 2: exactly what was declared. Nothing is a withdrawal until the button next to it is pressed. */
export function ConfirmSummary({ m, request }: { m: R; request: Pick<RequestInfo, "orderNumber" | "lines"> }) {
  return (
    <div className="flex flex-col gap-3">
      <p>{m.confirmIntro(request.orderNumber)}</p>
      <ul className="divide-y divide-border rounded-lg border border-border px-4">
        {request.lines.map((line) => (
          <li key={line.lineId} className="flex flex-wrap justify-between gap-3 py-3">
            <span className="min-w-0 break-words">{line.title}</span>
            <span className="whitespace-nowrap">× {line.quantity}</span>
          </li>
        ))}
      </ul>
      <p className="text-sm text-muted">{m.confirmHint}</p>
    </div>
  );
}

/** The confirmation, with the acknowledgement as the store sent it and its reference, so the shopper has it at once. */
export function DoneSummary({ m, done, locale, base }: { m: R; done: DoneInfo; locale: string; base: string }) {
  const when = formatDeclaration(done.confirmedAt, locale, done.timeZone);
  const day = (iso: string) => new Intl.DateTimeFormat(safeLocale(locale), { dateStyle: "long", timeZone: done.timeZone }).format(new Date(iso));
  return (
    <div className="flex flex-col gap-4">
      <p>{m.done.received(when)}</p>
      {done.reference && (
        <p>
          <span className="text-muted">{m.done.reference}: </span>
          <strong className="font-mono">{done.reference}</strong>
        </p>
      )}
      <p role="status">{done.sent ? m.done.sentTo(done.email) : m.done.notSent}</p>
      <ul className="flex flex-col gap-1">
        {done.nothingSent ? <li>{m.done.nothingSent}</li> : <li>{m.done.sendBack(formatStoreDay(done.sendBackBy, locale))}</li>}
        <li>{m.done.refundBy(day(done.refundBy))}</li>
      </ul>
      {!done.nothingSent && <p className="text-sm text-muted">{m.done.refundWait}</p>}
      {done.text && (
        <section aria-labelledby="ack-heading" className="rounded-lg border border-border p-4">
          <h3 id="ack-heading" className="mb-2 font-medium">
            {m.done.acknowledgementHeading}
          </h3>
          <p className="whitespace-pre-line break-words text-sm">{done.text}</p>
        </section>
      )}
      {done.returns.length > 0 && (
        <ul className="flex flex-col gap-1">
          {done.returns.map((r) => (
            <li key={r.token}>
              <a href={`${base}/returns/${r.token}`} className="underline">
                {m.done.track}: {r.number}
              </a>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function safeLocale(locale: string): string {
  try {
    return Intl.DateTimeFormat.supportedLocalesOf(locale).length > 0 ? locale : "en";
  } catch {
    return "en";
  }
}

/** The hidden fields every step carries, so a step needs nothing from a cookie or storage: who, which order, how it was proven. */
export function Carried({ values, orderKey }: { values: { name: string; email: string; orderNumber: string }; orderKey: string | null }) {
  return (
    <>
      <input type="hidden" name={FIELD.name} value={values.name} />
      <input type="hidden" name={FIELD.email} value={values.email} />
      <input type="hidden" name={FIELD.orderNumber} value={values.orderNumber} />
      {orderKey && <input type="hidden" name={FIELD.orderKey} value={orderKey} />}
    </>
  );
}

/** Which of the form's fields have a message, for the summary a screen reader hears first. */
export function errorList(m: R, errors: FieldErrors): { key: FieldKey; text: string }[] {
  const labels: Record<FieldKey, string> = {
    name: m.name,
    email: m.email,
    orderNumber: m.orderNumber,
    lines: m.linesHeading,
    reason: m.returnRequest.reasonLabel,
    note: m.returnRequest.noteLabel,
  };
  return (Object.keys(errors) as FieldKey[]).map((key) => ({ key, text: `${labels[key]}: ${fieldMessage(m, errors[key]) ?? m.failed}` }));
}

/** A declined line's own words: the system's reasons have their text, a person's are shown as written. */
export function declinedReason(m: R, reason: string | null): string {
  const code = refusalCode(reason);
  return code ? m.refusal[code] : (reason ?? "");
}
