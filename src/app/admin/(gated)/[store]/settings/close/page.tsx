import type { Metadata } from "next";
import Link from "next/link";

import { ActionForm, SubmitButton } from "@/components/admin/action-form";
import { REOPEN_DAYS, closureBlockers, closureWarnings, ownerMayReopen, reopenDeadline } from "@/lib/store-closure";
import { signedInRecently } from "@/server/auth";
import { requireOwnerRole } from "@/server/permissions";
import { storeObligations, storeState } from "@/server/store-closure";

import { closeStoreAction, reopenStoreAction, signInAgainAction } from "./actions";

export const metadata: Metadata = { title: "Close store" };

const control = "min-h-10 rounded-md border border-border bg-background px-3 font-normal";
const day = (date: Date) => date.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });

/** Closing the store, or what a store that is closed or suspended can still do (D171). Owners only. */
export default async function CloseStorePage({ params }: PageProps<"/admin/[store]/settings/close">) {
  const { store } = await requireOwnerRole((await params).store);
  const state = await storeState(store.id);
  if (!state) return null;

  if (state.status !== "active") {
    const mayReopen = ownerMayReopen(state.status, state.closedAt, new Date());
    return (
      <div className="flex max-w-2xl flex-col gap-6">
        <div>
          <h1 className="text-2xl font-semibold">{state.status === "closed" ? "This store is closed" : "This store is suspended"}</h1>
          <p className="text-sm text-muted">
            {state.status === "closed"
              ? `It takes no orders. Its orders, invoices, returns and customer data stay available to you, and are kept for the bookkeeping period of the seller's country.`
              : "Kaizen has paused it. It takes no orders and cannot be changed until Kaizen reopens it."}
          </p>
          {state.reason && <p className="mt-2 text-sm">Reason given: {state.reason}</p>}
        </div>
        {state.status === "closed" && state.closedAt && (
          <p className="text-sm">
            {mayReopen
              ? `You can reopen the store until ${day(reopenDeadline(state.closedAt))}. After that, ask Kaizen.`
              : `The thirty days for reopening ended ${day(reopenDeadline(state.closedAt))}. Ask Kaizen to reopen the store.`}
          </p>
        )}
        {mayReopen && (
          <ActionForm action={reopenStoreAction.bind(null, store.slug)} className="flex flex-col gap-3" successMessage="The store is open again.">
            <p className="text-sm text-muted">
              Reopening starts sales again. Its own domains were released when it closed: add them again under Domains. If its Kaizen plan has ended, choose a plan under Billing.
            </p>
            <div>
              <SubmitButton>Reopen the store</SubmitButton>
            </div>
          </ActionForm>
        )}
        <p className="text-sm">
          <Link href={`/admin/${store.slug}/orders`} className="underline underline-offset-2">
            Orders
          </Link>{" "}
          ·{" "}
          <Link href={`/admin/${store.slug}/invoices`} className="underline underline-offset-2">
            Invoices
          </Link>{" "}
          ·{" "}
          <Link href={`/admin/${store.slug}/customers`} className="underline underline-offset-2">
            Customers
          </Link>
        </p>
      </div>
    );
  }

  const obligations = await storeObligations(store.id);
  const blockers = closureBlockers(obligations);
  const warnings = closureWarnings(obligations);
  const fresh = await signedInRecently();
  return (
    <div className="flex max-w-2xl flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Close store</h1>
        <p className="text-sm text-muted">
          Closing stops sales and takes the shop off the web. Nothing is deleted: orders, invoices and customer data stay here for you to read and download, kept for the bookkeeping period
          of the seller&apos;s country and then made anonymous. You can reopen the store yourself for {REOPEN_DAYS} days.
        </p>
      </div>

      {blockers.length > 0 && (
        <section aria-labelledby="blockers" className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-4">
          <h2 id="blockers" className="font-medium">
            Before you can close it
          </h2>
          <ul className="list-disc pl-5 text-sm">
            {blockers.map((b) => (
              <li key={b}>{b}</li>
            ))}
          </ul>
        </section>
      )}

      <section aria-labelledby="warnings" className="flex flex-col gap-2">
        <h2 id="warnings" className="font-medium">
          What closing does
        </h2>
        <ul className="list-disc pl-5 text-sm text-muted">
          {warnings.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      </section>

      {blockers.length === 0 && !fresh && (
        <section aria-labelledby="signin" className="flex flex-col gap-2 rounded-lg border border-border bg-background p-4">
          <h2 id="signin" className="font-medium">
            Sign in again first
          </h2>
          <p className="text-sm text-muted">Closing a store needs a sign-in from the last ten minutes. You come back to this page afterwards.</p>
          <form action={signInAgainAction.bind(null, store.slug)}>
            <SubmitButton>Sign in again</SubmitButton>
          </form>
        </section>
      )}

      {blockers.length === 0 && fresh && (
        <ActionForm action={closeStoreAction.bind(null, store.slug)} className="flex flex-col gap-3 rounded-lg border border-border bg-background p-4" successMessage="The store is closed.">
          <label className="flex flex-col gap-1 text-sm font-medium">
            Type the store&apos;s address, <span className="font-mono">{store.slug}</span>, to confirm
            <input name="address" required autoComplete="off" spellCheck={false} className={control} />
          </label>
          <div>
            <SubmitButton>Close {store.name}</SubmitButton>
          </div>
        </ActionForm>
      )}
    </div>
  );
}
