"use client";

import { useId, useState, useTransition } from "react";

import type { DraftActionResponse } from "@/app/admin/(gated)/[store]/orders/drafts/actions";
import { field, hint, primary, secondary } from "@/components/admin/data/ui";
import { cashRuleWords } from "@/lib/cash-limits";
import { MANUAL_METHOD_LABELS, MANUAL_PAYMENT_METHODS, type ManualPaymentMethod } from "@/lib/draft-input";
import { DRAFT_REFERENCE_MAX, DRAFT_VALID_DAYS_MAX, DRAFT_VALID_DAYS_MIN, MANUAL_RECEIVED_DAYS_MAX } from "@/lib/order-limits";

/**
 * The cash warning beside the Cash method (wave 3, D173, `docs/wave-3-orders.md` section 8, items 6 and 7). English admin text, flagged for review. It names the cash register rules and the ceilings on cash
 * payments held as data (`src/lib/cash-limits.ts`: some are refused when recorded).
 */
export const CASH_WARNING = `Cash taken when goods are handed over is a cash sale under the cash register rules in many countries. Record it here only if your accountant says this is allowed. Recording a payment here does not replace a cash register. Some countries also forbid a business to receive cash above a ceiling. ${cashRuleWords()} Other countries may have a rule Kaizen does not know of: ask your accountant.`;

/** A result line of an action: green-neutral when it worked, red when it did not, with the problems of the draft listed when there are any. */
export function ActionMessage({ result }: { result: DraftActionResponse | null }) {
  if (!result) return null;
  return (
    <div role={result.ok ? "status" : "alert"} aria-live="polite" className={`flex flex-col gap-1 text-sm ${result.ok ? "" : "text-red-700 dark:text-red-400"}`}>
      <p>{result.message}</p>
      {result.problems && result.problems.length > 0 && (
        <ul className="list-disc pl-5">
          {result.problems.map((p, i) => (
            <li key={`${p.code}-${i}`}>{p.text}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * A link to share, shown ONCE (wave 3, D173): only its hash is kept, so it cannot be shown again. A new link replaces this one. The link is a bearer secret: anyone who has it can open the page that pays this
 * one order, and nothing else.
 */
export function LinkNotice({ link, onClose }: { link: string; onClose: () => void }) {
  const id = useId();
  const [copied, setCopied] = useState(false);
  return (
    <section aria-labelledby={id} className="flex flex-col gap-2 rounded-lg border border-foreground bg-surface p-4 text-sm">
      <h2 id={id} className="font-medium">
        The pay link
      </h2>
      <p className={hint}>It is shown only now: Kaizen keeps nothing it could show again. Anyone who has it can open the page to pay this order. If you lose it, make a new one: the old one stops working.</p>
      <input readOnly value={link} aria-label="The pay link" onFocus={(event) => event.currentTarget.select()} className={`${field} w-full font-mono text-xs`} />
      <div className="flex gap-2">
        <button
          type="button"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(link);
              setCopied(true);
            } catch {
              setCopied(false);
            }
          }}
          className={primary}
        >
          {copied ? "Copied" : "Copy the link"}
        </button>
        <button type="button" onClick={onClose} className={secondary}>
          I have copied it
        </button>
      </div>
    </section>
  );
}

/**
 * *Send to the customer* and *Create a link to share* (wave 3, D173, `docs/wave-3-orders.md` 2.4). The draft is saved first (`ensureSaved()` answers the version that is saved, or null when it cannot be). Sending makes the
 * order, takes its number and holds the stock until the link ends; the customer gets an email with the link. A link to share is the same without the email. Disabled, with the reason written, while the draft cannot be sent.
 */
export function SendBox({
  defaultDays,
  blockedReason,
  ensureSaved,
  send,
  onResult,
}: {
  defaultDays: number;
  /** Why the draft cannot be sent now, in words, or null. */
  blockedReason: string | null;
  ensureSaved: () => Promise<number | null>;
  send: (request: { version: number; validDays: number; createLink: boolean }) => Promise<DraftActionResponse>;
  onResult: (result: DraftActionResponse) => void;
}) {
  const id = useId();
  const [days, setDays] = useState(String(defaultDays));
  const [result, setResult] = useState<DraftActionResponse | null>(null);
  const [working, startTransition] = useTransition();
  const valid = Number.isInteger(Number(days)) && Number(days) >= DRAFT_VALID_DAYS_MIN && Number(days) <= DRAFT_VALID_DAYS_MAX;
  const run = (createLink: boolean) =>
    startTransition(async () => {
      setResult(null);
      const version = await ensureSaved();
      if (version === null) {
        setResult({ ok: false, message: "The draft has problems that stop it being saved. Fix them first." });
        return;
      }
      const answer = await send({ version, validDays: Number(days), createLink });
      setResult(answer);
      onResult(answer);
    });
  return (
    <section aria-labelledby={`${id}-h`} className="flex flex-col gap-3 rounded-lg border border-border bg-background p-4 text-sm">
      <h2 id={`${id}-h`} className="font-medium">
        Send it
      </h2>
      <p className={hint}>
        The customer gets an email with a link to a page that shows this order and a button to pay on Stripe&apos;s page. Sending makes the order and takes its number, and holds the stock until the link ends. A sent draft cannot be
        edited: reopen it first, which cancels this order and makes a new one when you send again.
      </p>
      <label className="flex flex-col gap-1 font-medium">
        The link is valid for (days) <span className="font-normal text-muted">{DRAFT_VALID_DAYS_MIN} to {DRAFT_VALID_DAYS_MAX}</span>
        <input type="number" inputMode="numeric" min={DRAFT_VALID_DAYS_MIN} max={DRAFT_VALID_DAYS_MAX} value={days} onChange={(e) => setDays(e.target.value)} className={`${field} w-28`} />
      </label>
      {blockedReason && <p className="text-muted">{blockedReason}</p>}
      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={working || !valid || blockedReason !== null} onClick={() => run(false)} className={primary}>
          {working ? "Working …" : "Send to the customer"}
        </button>
        <button type="button" disabled={working || !valid || blockedReason !== null} onClick={() => run(true)} className={secondary}>
          Create a link to share
        </button>
      </div>
      <ActionMessage result={result} />
    </section>
  );
}

/**
 * *Mark as paid outside Kaizen* (wave 3, D173): the customer paid by bank transfer, in cash or another way. The owner always may; staff only when the owner allowed it. Kaizen then makes the order paid, issues the invoice
 * (which says it was paid outside the online checkout) and emails the confirmation, but takes no sale fee on money it never touched.
 */
export function PaidOutsideBox({
  allowed,
  hasEmail,
  blockedReason,
  ensureSaved,
  record,
  onResult,
}: {
  allowed: boolean;
  hasEmail: boolean;
  blockedReason: string | null;
  ensureSaved: () => Promise<number | null>;
  record: (input: { version: number; method: ManualPaymentMethod; reference?: string; receivedOn?: string }) => Promise<DraftActionResponse>;
  onResult: (result: DraftActionResponse) => void;
}) {
  const id = useId();
  const [method, setMethod] = useState<ManualPaymentMethod>("bank_transfer");
  const [reference, setReference] = useState("");
  const [receivedOn, setReceivedOn] = useState("");
  const [result, setResult] = useState<DraftActionResponse | null>(null);
  const [working, startTransition] = useTransition();
  if (!allowed) {
    return (
      <section className="rounded-lg border border-border bg-background p-4 text-sm">
        <h2 className="mb-1 font-medium">Paid outside Kaizen</h2>
        <p className="text-muted">Only the owner can record a payment taken outside Kaizen, unless the owner allows staff to (Settings, Orders).</p>
      </section>
    );
  }
  return (
    <section aria-labelledby={`${id}-h`} className="flex flex-col gap-3 rounded-lg border border-border bg-background p-4 text-sm">
      <h2 id={`${id}-h`} className="font-medium">
        Mark as paid outside Kaizen
      </h2>
      <p className={hint}>
        The customer paid you by bank transfer, in cash or another way. The order is made and marked paid, the invoice is issued saying it was paid outside the online checkout, and the confirmation (which states the right of
        withdrawal) is emailed to the customer. Kaizen did not touch the money and takes no sale fee on it. A refund of it is only recorded: you pay the customer back yourself.
      </p>
      <fieldset className="flex flex-col gap-1">
        <legend className="mb-1 font-medium">How was it paid?</legend>
        {MANUAL_PAYMENT_METHODS.map((m) => (
          <label key={m} className="flex items-center gap-2">
            <input type="radio" name={`${id}-method`} value={m} checked={method === m} onChange={() => setMethod(m)} className="size-4" />
            {MANUAL_METHOD_LABELS[m]}
          </label>
        ))}
      </fieldset>
      {method === "cash" && (
        <p role="note" className="rounded-md border border-border bg-surface p-3">
          {CASH_WARNING}
        </p>
      )}
      <label className="flex flex-col gap-1 font-medium">
        Received on <span className="font-normal text-muted">(leave empty if it was today)</span>
        <input type="date" value={receivedOn} onChange={(e) => setReceivedOn(e.target.value)} max={new Date().toISOString().slice(0, 10)} className={`${field} w-44`} />
        <span className={`${hint} font-normal`}>
          The invoice&apos;s supply date, and so the VAT and OSS period the sale is reported in, is this day, not the day you record it. At most {MANUAL_RECEIVED_DAYS_MAX} days back. A transfer received on the 30th and recorded on the 2nd belongs to the 30th.
        </span>
      </label>
      <label className="flex flex-col gap-1 font-medium">
        Reference <span className="font-normal text-muted">(optional, kept in the order&apos;s history)</span>
        <input value={reference} onChange={(e) => setReference(e.target.value)} maxLength={DRAFT_REFERENCE_MAX} autoComplete="off" className={field} />
      </label>
      {!hasEmail && <p className="text-muted">Add the customer&apos;s email address first: the confirmation goes to it and is not optional.</p>}
      {blockedReason && <p className="text-muted">{blockedReason}</p>}
      <div>
        <button
          type="button"
          disabled={working || !hasEmail || blockedReason !== null}
          onClick={() => {
            if (!window.confirm("Record this draft as paid outside Kaizen? The order is made and paid, the invoice is issued and the customer is emailed. This cannot be undone: a mistake is corrected with a refund.")) return;
            startTransition(async () => {
              setResult(null);
              const version = await ensureSaved();
              if (version === null) {
                setResult({ ok: false, message: "The draft has problems that stop it being saved. Fix them first." });
                return;
              }
              const answer = await record({ version, method, ...(reference.trim() ? { reference: reference.trim() } : {}), ...(receivedOn ? { receivedOn } : {}) });
              setResult(answer);
              onResult(answer);
            });
          }}
          className={secondary}
        >
          {working ? "Working …" : "Record the payment"}
        </button>
      </div>
      <ActionMessage result={result} />
    </section>
  );
}
