import Link from "next/link";
import type { ReactNode } from "react";

import type { DeleteFacts } from "@/lib/privacy-delete-facts";
import type { ShopperPrivacyText } from "@/lib/privacy-text";

/**
 * My account's "Your data" (wave 1, 1g, D162, `docs/wave-1g-gdpr.md` 2.4): the card in My account, the page with the download and the way
 * to deletion, the delete page that says what goes and what stays, and the result. Presentational: the words come from `privacy-text.ts`
 * (hand-written, legal), the counts and dates from the server, the forms (client components) as children.
 */

const card = "flex items-center justify-between gap-4 rounded-lg border border-border p-4 hover:bg-surface";

/** The card in My account: a link to the page, not a form (nothing here deletes anything). */
export function PrivacyCard({ text, storeName, href }: { text: ShopperPrivacyText; storeName: string; href: string }) {
  return (
    <section aria-labelledby="privacy-card-heading" className="flex flex-col gap-3 border-t border-border pt-6">
      <Link href={href} className={card}>
        <span>
          <span id="privacy-card-heading" className="font-medium">
            {text.cardTitle}
          </span>
          <span className="block text-sm text-muted">{text.cardIntro(storeName)}</span>
        </span>
        <span aria-hidden="true">→</span>
      </Link>
    </section>
  );
}

export type PrivacyNotice = "stale" | "too_large" | "busy" | "failed" | null;

/** The page: the download and the way to deletion once the session is fresh, the step-up (the child) while it is not. */
export function PrivacyPageView({
  text,
  storeName,
  fresh,
  notice,
  exportHref,
  deleteHref,
  accountHref,
  accountLabel,
  stepUp,
}: {
  text: ShopperPrivacyText;
  storeName: string;
  fresh: boolean;
  notice: PrivacyNotice;
  /** Where the download form posts. */
  exportHref: string;
  /** The delete page. */
  deleteHref: string;
  accountHref: string;
  /** The link back to My account, in the store's own words. */
  accountLabel: string;
  stepUp: ReactNode;
}) {
  const noticeText = notice === "stale" ? text.staleSession : notice === "too_large" ? text.tooLarge : notice === "busy" ? text.tooMany : notice === "failed" ? text.failed : null;
  return (
    <>
      <header className="flex flex-col gap-2">
        <h1 className="text-3xl font-heading tracking-tight">{text.cardTitle}</h1>
        <p>{text.cardIntro(storeName)}</p>
      </header>
      {noticeText && (
        <p role="alert" className="rounded-lg border border-border bg-surface p-4">
          {noticeText}
        </p>
      )}
      {fresh ? (
        <>
          <section aria-labelledby="download-heading" className="flex flex-col gap-3">
            <h2 id="download-heading" className="text-xl font-heading">
              {text.downloadHeading}
            </h2>
            <p>{text.downloadText}</p>
            <form method="post" action={exportHref}>
              <button type="submit" className="min-h-11 rounded-button border border-border px-5">
                {text.downloadButton}
              </button>
            </form>
          </section>
          <section aria-labelledby="delete-heading" className="flex flex-col gap-3 border-t border-border pt-6">
            <h2 id="delete-heading" className="text-xl font-heading">
              {text.deleteHeading}
            </h2>
            <p>{text.deleteText}</p>
            <div>
              <Link href={deleteHref} className="inline-flex min-h-11 items-center rounded-button border border-border px-5">
                {text.deleteButton}
              </Link>
            </div>
          </section>
        </>
      ) : (
        stepUp
      )}
      <p>
        <Link href={accountHref} className="underline">
          {accountLabel}
        </Link>
      </p>
    </>
  );
}

/** The delete page: what goes now, what stays and until when, what else happens, then the one button (the child). */
export function DeletePlanView({ text, storeName, facts, form }: { text: ShopperPrivacyText; storeName: string; facts: DeleteFacts; form: ReactNode }) {
  const stays = facts.keptOrders > 0 && facts.keptUntil !== null;
  const also: string[] = [];
  if (facts.subscriptions > 0) also.push(text.subscriptionsEnd(facts.subscriptions));
  if (facts.cards > 0) also.push(text.cardsRemoved(facts.cards));
  if (facts.bonus) also.push(text.bonusLost(facts.bonus));
  also.push(text.stripeNote);
  return (
    <>
      <header className="flex flex-col gap-2">
        <h1 className="text-3xl font-heading tracking-tight">{text.deleteTitle}</h1>
        <p>{text.deleteIntro(storeName)}</p>
      </header>
      <section aria-labelledby="goes-heading" className="flex flex-col gap-2">
        <h2 id="goes-heading" className="text-xl font-heading">
          {text.goesHeading}
        </h2>
        <ul className="list-disc pl-5">
          {text.goesItems.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </section>
      {(stays || facts.optOutKept) && (
        <section aria-labelledby="stays-heading" className="flex flex-col gap-2">
          <h2 id="stays-heading" className="text-xl font-heading">
            {text.staysHeading}
          </h2>
          {stays && <p>{text.staysOrders(facts.keptOrders, facts.keptUntil ?? "")}</p>}
          {facts.optOutKept && <p>{text.staysOptOut}</p>}
        </section>
      )}
      <ul className="flex flex-col gap-2">
        {also.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
      {form}
    </>
  );
}

/** The result, shown after the session has ended: what was done, with the counts and the day the kept orders' details go (never a name or address). */
export function PrivacyDoneView({
  text,
  kept,
  until,
  emailSent,
  accountHref,
  accountLabel,
}: {
  text: ShopperPrivacyText;
  kept: number;
  until: string | null;
  emailSent: boolean;
  accountHref: string;
  accountLabel: string;
}) {
  return (
    <>
      <header className="flex flex-col gap-2">
        <h1 className="text-3xl font-heading tracking-tight">{text.doneTitle}</h1>
        <p role="status">{emailSent ? text.doneText : text.doneTextNoEmail}</p>
      </header>
      {kept > 0 && until && <p>{text.doneKept(kept, until)}</p>}
      {emailSent && <p className="text-sm text-muted">{text.doneEmail}</p>}
      <p>
        <Link href={accountHref} className="underline">
          {accountLabel}
        </Link>
      </p>
    </>
  );
}
