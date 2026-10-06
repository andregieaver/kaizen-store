"use client";

import Link from "next/link";
import { useId, useState, useTransition } from "react";

import type { DraftActionResponse, DraftProblemWords } from "@/app/admin/(gated)/[store]/orders/drafts/actions";
import { hint, primary, secondary } from "@/components/admin/data/ui";
import type { DraftLike } from "@/lib/draft-editor";
import type { ManualPaymentMethod } from "@/lib/draft-input";
import { DRAFT_SENDS_PER_DAY } from "@/lib/order-limits";
import { canReopenDraft, isDraftDeletable, type DraftStatus, DRAFT_STATUS_LABELS } from "@/lib/draft-status";
import type { DraftSummary } from "@/server/draft-orders";

import { DraftSummaryPanel } from "./draft-summary";
import { ActionMessage, PaidOutsideBox } from "./draft-send";

export type DraftSentActions = {
  resend: (request: { createLink: boolean }) => Promise<DraftActionResponse>;
  reopen: () => Promise<DraftActionResponse>;
  remove: () => Promise<DraftActionResponse>;
  paidOutside: (input: { version: number; method: ManualPaymentMethod; reference?: string }) => Promise<DraftActionResponse>;
};

const card = "flex flex-col gap-2 rounded-lg border border-border bg-background p-4 text-sm";

/** One address as the lines a person reads. */
const addressLines = (a: Record<string, string | null>): string[] =>
  [a.name, a.line1, a.line2, `${a.postalCode ?? ""} ${a.city ?? ""}`.trim(), a.country].filter((part): part is string => Boolean(part && part.trim()));

/**
 * A draft that is not open (wave 3, D173, `docs/wave-3-orders.md` 2.4): sent (its order exists and its stock is held until the link ends), paid, expired or cancelled; or an open draft seen by someone who may only read.
 * It is read-only: a sent draft is *reopened* to be edited, which cancels its unpaid order (the number stays on it, the stock is released) and makes a new one when sent again. A sent draft can be sent again (a new link
 * replaces the old), turned into a link to share (shown once), or recorded as paid outside Kaizen. A paid draft is final.
 */
export function DraftSentPanel({
  slug,
  number,
  status,
  draft,
  version,
  orderId,
  orderNumber,
  expiresAt,
  linkRanOut,
  linkLive,
  paySendsToday,
  summary,
  problems,
  currency,
  locale,
  timeZone,
  canWrite,
  mayRecordOutside,
  actions,
  onResult,
}: {
  slug: string;
  number: string;
  status: DraftStatus;
  draft: DraftLike;
  version: number;
  orderId: string | null;
  orderNumber: string | null;
  expiresAt: string | null;
  /** The link's time has passed (worked out by the page, which knows the time): the job cancels the order within minutes. */
  linkRanOut: boolean;
  linkLive: boolean;
  paySendsToday: number;
  summary: DraftSummary | null;
  problems: DraftProblemWords[];
  currency: string;
  locale: string;
  timeZone: string;
  canWrite: boolean;
  mayRecordOutside: boolean;
  actions: DraftSentActions;
  onResult: (result: DraftActionResponse) => void;
}) {
  const id = useId();
  const [result, setResult] = useState<DraftActionResponse | null>(null);
  const [working, startTransition] = useTransition();
  const when = (iso: string) => new Date(iso).toLocaleString(locale, { dateStyle: "medium", timeStyle: "short", timeZone });
  const run = (action: () => Promise<DraftActionResponse>) =>
    startTransition(async () => {
      setResult(null);
      const answer = await action();
      setResult(answer);
      onResult(answer);
    });
  const ship = addressLines(draft.shippingAddress);

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
      <div className="flex min-w-0 flex-col gap-6">
        <section aria-labelledby={`${id}-status`} className={card}>
          <h2 id={`${id}-status`} className="font-medium">
            {number}: {DRAFT_STATUS_LABELS[status].toLowerCase()}
          </h2>
          {status === "open" && <p className="text-muted">This draft is open. You can read it, but only someone who may change orders can edit it.</p>}
          {status === "sent" && (
            <p>
              Sent to the customer. Its order {orderId && orderNumber ? <Link href={`/admin/${slug}/orders/${orderId}`} className="underline underline-offset-2">#{orderNumber}</Link> : "exists"} is waiting for payment and its stock is held
              {expiresAt ? ` until ${when(expiresAt)}` : ""}. {linkLive ? "The pay link works." : "There is no live link."} {linkRanOut ? "The link has run out: the job cancels the order and releases the stock within minutes." : ""}
            </p>
          )}
          {status === "paid" && (
            <p>
              Paid. Its order {orderId && orderNumber ? <Link href={`/admin/${slug}/orders/${orderId}`} className="underline underline-offset-2">#{orderNumber}</Link> : "is made"} is an ordinary order now. A paid draft is final.
            </p>
          )}
          {status === "expired" && <p>The link ran out unpaid. The order was cancelled and its stock released; the order number stays on the cancelled order. Reopen the draft to send it again: that makes a new order and a new number.</p>}
          {status === "cancelled" && <p>This draft was cancelled. Reopen it to send it again.</p>}
        </section>

        {status === "sent" && canWrite && (
          <section aria-labelledby={`${id}-send`} className={card}>
            <h2 id={`${id}-send`} className="font-medium">
              The pay link
            </h2>
            <p className={hint}>
              A new link replaces the old one, so an earlier link stops working. A draft&apos;s link can be sent {DRAFT_SENDS_PER_DAY} times a day ({paySendsToday} today). Kaizen keeps only a fingerprint of a link, so one made for sharing is shown once.
            </p>
            <div className="flex flex-wrap gap-2">
              <button type="button" disabled={working} onClick={() => run(() => actions.resend({ createLink: false }))} className={secondary}>
                Send again
              </button>
              <button type="button" disabled={working} onClick={() => run(() => actions.resend({ createLink: true }))} className={secondary}>
                Create a link to share
              </button>
            </div>
          </section>
        )}

        {canWrite && canReopenDraft(status) && (
          <section aria-labelledby={`${id}-reopen`} className={card}>
            <h2 id={`${id}-reopen`} className="font-medium">
              Change it
            </h2>
            <p className={hint}>
              {status === "sent"
                ? "To change a sent draft, reopen it: its Stripe session is closed, the unpaid order is cancelled (its number stays on it) and the stock is released. Sending again makes a new order and a new number."
                : "Reopen the draft to edit it and send it again."}
            </p>
            <div>
              <button
                type="button"
                disabled={working}
                onClick={() => {
                  if (status === "sent" && !window.confirm(`Reopen ${number}? Its order is cancelled and the pay link stops working.`)) return;
                  run(actions.reopen);
                }}
                className={primary}
              >
                Reopen to edit
              </button>
            </div>
          </section>
        )}

        {canWrite && status === "sent" && (
          <PaidOutsideBox
            allowed={mayRecordOutside}
            hasEmail={Boolean(draft.email && draft.email.trim() !== "")}
            blockedReason={null}
            ensureSaved={async () => version}
            record={(input) => actions.paidOutside(input)}
            onResult={onResult}
          />
        )}

        <section aria-labelledby={`${id}-who`} className={card}>
          <h2 id={`${id}-who`} className="font-medium">
            Customer and notes
          </h2>
          <dl className="grid gap-x-6 gap-y-1 sm:grid-cols-[8rem_minmax(0,1fr)]">
            <dt className="text-muted">Email</dt>
            <dd className="break-all">{draft.email ?? "–"}</dd>
            <dt className="text-muted">Phone</dt>
            <dd>{draft.phone ?? "–"}</dd>
            <dt className="text-muted">Ship to</dt>
            <dd>{ship.length === 0 ? "–" : ship.map((l, i) => <span key={`${i}-${l}`} className="block">{l}</span>)}</dd>
            {draft.companyName && (
              <>
                <dt className="text-muted">Company</dt>
                <dd>
                  {draft.companyName}
                  {draft.organisationNumber && <span className="block text-muted">Organisation number {draft.organisationNumber}</span>}
                </dd>
              </>
            )}
            <dt className="text-muted">Note to the buyer</dt>
            <dd className="whitespace-pre-wrap break-words">{draft.noteToBuyer ?? "–"}</dd>
            <dt className="text-muted">Internal note</dt>
            <dd className="whitespace-pre-wrap break-words">{draft.internalNote ?? "–"}</dd>
            <dt className="text-muted">Tags</dt>
            <dd>{draft.tags.length === 0 ? "–" : draft.tags.join(", ")}</dd>
          </dl>
        </section>

        {canWrite && isDraftDeletable(status) && (
          <section aria-labelledby={`${id}-delete`} className={card}>
            <h2 id={`${id}-delete`} className="font-medium">
              Delete the draft
            </h2>
            <p className={hint}>The order it made, if any, stays: it is a real order. Only the draft&apos;s own copy of the customer&apos;s details goes.</p>
            <div>
              <button
                type="button"
                disabled={working}
                onClick={() => {
                  if (!window.confirm(`Delete draft ${number}? This cannot be undone.`)) return;
                  run(actions.remove);
                }}
                className={secondary}
              >
                Delete draft
              </button>
            </div>
          </section>
        )}
        <ActionMessage result={result} />
      </div>

      <aside className="lg:sticky lg:top-32 lg:self-start">
        <DraftSummaryPanel summary={summary} problems={status === "open" ? problems : []} currency={currency} locale={locale} state="fresh" />
      </aside>
    </div>
  );
}
