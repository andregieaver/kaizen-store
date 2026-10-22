"use client";

import Link from "next/link";
import { useId, useState, useTransition } from "react";

import type { DraftActionResponse, DraftProblemWords } from "@/app/admin/(gated)/[store]/orders/drafts/actions";
import { hint, primary, secondary } from "@/components/admin/data/ui";
import type { DraftLike } from "@/lib/draft-editor";
import type { ManualPaymentMethod } from "@/lib/draft-input";
import { DRAFT_SENDS_PER_DAY } from "@/lib/order-limits";
import { canReopenDraft, isDraftDeletable, type DraftStatus } from "@/lib/draft-status";
import { useAdminLang, useAdminText } from "@/components/admin/admin-text";
import { ADMIN_LANG_FACTS } from "@/lib/admin-lang";
import { fillWords } from "@/lib/drafts-words";
import type { DraftSummary } from "@/server/draft-orders";

import { DraftSummaryPanel } from "./draft-summary";
import { ActionMessage, PaidOutsideBox } from "./draft-send";

export type DraftSentActions = {
  resend: (request: { createLink: boolean }) => Promise<DraftActionResponse>;
  reopen: () => Promise<DraftActionResponse>;
  remove: () => Promise<DraftActionResponse>;
  paidOutside: (input: { version: number; method: ManualPaymentMethod; reference?: string }) => Promise<DraftActionResponse>;
};

const card = "flex flex-col gap-2 rounded-lg border border-line bg-card p-4 text-sm";

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
  const all = useAdminText("drafts");
  const w = all.sent;
  const lang = useAdminLang();
  const [result, setResult] = useState<DraftActionResponse | null>(null);
  const [working, startTransition] = useTransition();
  const when = (iso: string) => new Date(iso).toLocaleString(lang === "en" ? locale : ADMIN_LANG_FACTS[lang].locale, { dateStyle: "medium", timeStyle: "short", timeZone });
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
          <h2 id={`${id}-status`} className="text-title text-ink">
            {number}: {all.status[status].toLowerCase()}
          </h2>
          {status === "open" && <p className="text-muted">{w.openNote}</p>}
          {status === "sent" && (
            <p>
              {w.sentStart} {orderId && orderNumber ? <Link href={`/admin/${slug}/orders/${orderId}`} className="underline underline-offset-2">#{orderNumber}</Link> : w.exists} {w.sentWaiting}
              {expiresAt ? fillWords(w.until, { when: when(expiresAt) }) : ""}. {linkLive ? w.linkWorks : w.noLink} {linkRanOut ? w.ranOut : ""}
            </p>
          )}
          {status === "paid" && (
            <p>
              {w.paidStart} {orderId && orderNumber ? <Link href={`/admin/${slug}/orders/${orderId}`} className="underline underline-offset-2">#{orderNumber}</Link> : w.isMade} {w.paidEnd}
            </p>
          )}
          {status === "expired" && <p>{w.expired}</p>}
          {status === "cancelled" && <p>{w.cancelled}</p>}
        </section>

        {status === "sent" && canWrite && (
          <section aria-labelledby={`${id}-send`} className={card}>
            <h2 id={`${id}-send`} className="text-title text-ink">
              {w.payLink}
            </h2>
            <p className={hint}>{fillWords(w.payLinkHint, { max: DRAFT_SENDS_PER_DAY, today: paySendsToday })}</p>
            <div className="flex flex-wrap gap-2">
              <button type="button" disabled={working} onClick={() => run(() => actions.resend({ createLink: false }))} className={secondary}>
                {w.sendAgain}
              </button>
              <button type="button" disabled={working} onClick={() => run(() => actions.resend({ createLink: true }))} className={secondary}>
                {w.share}
              </button>
            </div>
          </section>
        )}

        {canWrite && canReopenDraft(status) && (
          <section aria-labelledby={`${id}-reopen`} className={card}>
            <h2 id={`${id}-reopen`} className="text-title text-ink">
              {w.change}
            </h2>
            <p className={hint}>
              {status === "sent" ? w.reopenSent : w.reopenOther}
            </p>
            <div>
              <button
                type="button"
                disabled={working}
                onClick={() => {
                  if (status === "sent" && !window.confirm(fillWords(w.reopenConfirm, { number }))) return;
                  run(actions.reopen);
                }}
                className={primary}
              >
                {w.reopen}
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
          <h2 id={`${id}-who`} className="text-title text-ink">
            {w.who}
          </h2>
          <dl className="grid gap-x-6 gap-y-1 sm:grid-cols-[8rem_minmax(0,1fr)]">
            <dt className="text-muted">{w.email}</dt>
            <dd className="break-all">{draft.email ?? "–"}</dd>
            <dt className="text-muted">{w.phone}</dt>
            <dd>{draft.phone ?? "–"}</dd>
            <dt className="text-muted">{w.shipTo}</dt>
            <dd>{ship.length === 0 ? "–" : ship.map((l, i) => <span key={`${i}-${l}`} className="block">{l}</span>)}</dd>
            {draft.companyName && (
              <>
                <dt className="text-muted">{w.company}</dt>
                <dd>
                  {draft.companyName}
                  {draft.organisationNumber && <span className="block text-muted">{fillWords(w.orgNumber, { number: draft.organisationNumber })}</span>}
                </dd>
              </>
            )}
            <dt className="text-muted">{w.noteToBuyer}</dt>
            <dd className="whitespace-pre-wrap break-words">{draft.noteToBuyer ?? "–"}</dd>
            <dt className="text-muted">{w.internalNote}</dt>
            <dd className="whitespace-pre-wrap break-words">{draft.internalNote ?? "–"}</dd>
            <dt className="text-muted">{w.tags}</dt>
            <dd>{draft.tags.length === 0 ? "–" : draft.tags.join(", ")}</dd>
          </dl>
        </section>

        {canWrite && isDraftDeletable(status) && (
          <section aria-labelledby={`${id}-delete`} className={card}>
            <h2 id={`${id}-delete`} className="text-title text-ink">
              {w.deleteTitle}
            </h2>
            <p className={hint}>{w.deleteHint}</p>
            <div>
              <button
                type="button"
                disabled={working}
                onClick={() => {
                  if (!window.confirm(fillWords(w.deleteConfirm, { number }))) return;
                  run(actions.remove);
                }}
                className={secondary}
              >
                {w.deleteButton}
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
