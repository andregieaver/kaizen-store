import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { ActionForm, SubmitButton } from "@/components/admin/action-form";
import { fillWords } from "@/lib/admin-fill";
import { adminDate } from "@/lib/admin-date";
import { adminLangOf } from "@/lib/admin-lang";
import { REOPEN_DAYS, closureBlockers, closureWarnings, ownerMayReopen, reopenDeadline } from "@/lib/store-closure";
import { SETTINGS_WORDS } from "@/lib/admin-words/settings";
import { signedInRecently } from "@/server/auth";
import { requireOwnerRole } from "@/server/permissions";
import { storeObligations, storeState } from "@/server/store-closure";
import { PhoneRow, PhoneRows } from "@/components/admin/phone-row";
import { CARD_CLASS, PageHeader } from "@/components/admin/ui";
import { QuietActionForm } from "@/components/admin/quiet-action-form";

import { closeStoreAction, reopenStoreAction, signInAgainAction } from "./actions";

export const metadata: Metadata = { title: "Close store" };

const control = "min-h-10 rounded-md border border-line bg-card px-3 font-normal";

/** Closing the store, or what a store that is closed or suspended can still do (D171). Owners only. */
export default async function CloseStorePage({ params }: PageProps<"/admin/[store]/settings/close">) {
  const member = await requireOwnerRole((await params).store);
  const { store } = member;
  // Kaizena Flow's own store is never closed (D466): the database refuses it too.
  if (store.house) notFound();
  const lang = adminLangOf(member.account.adminLocale);
  const w = SETTINGS_WORDS[lang].close;
  const state = await storeState(store.id);
  if (!state) return null;

  if (state.status !== "active") {
    const mayReopen = ownerMayReopen(state.status, state.closedAt, new Date());
    return (
      <div className="flex max-w-2xl flex-col gap-6">
        <div>
          <PageHeader
            title={<>{state.status === "closed" ? w.closedTitle : w.suspendedTitle}</>}
            description={<>{state.status === "closed" ? w.closedText : w.suspendedText}</>}
          />
          {state.reason && <p className="mt-2 text-sm">{fillWords(w.reason, { reason: state.reason })}</p>}
        </div>
        {state.status === "closed" && state.closedAt && (
          <p className="text-sm">
            {fillWords(mayReopen ? w.mayReopen : w.reopenEnded, { date: adminDate(store, reopenDeadline(state.closedAt), "long", lang) })}
          </p>
        )}
        {mayReopen && (
          <ActionForm action={reopenStoreAction.bind(null, store.slug)} className="flex flex-col gap-3" successMessage={w.reopened}>
            <p className="text-sm text-muted">{w.reopenText}</p>
            <div>
              <SubmitButton>{w.reopen}</SubmitButton>
            </div>
          </ActionForm>
        )}
        <TakeAway slug={store.slug} w={w} />
        <p className="text-sm">
          <Link href={`/admin/${store.slug}/orders`} className="underline underline-offset-2">
            {w.orders}
          </Link>{" "}
          ·{" "}
          <Link href={`/admin/${store.slug}/invoices`} className="underline underline-offset-2">
            {w.invoices}
          </Link>{" "}
          ·{" "}
          <Link href={`/admin/${store.slug}/customers`} className="underline underline-offset-2">
            {w.customers}
          </Link>
        </p>
      </div>
    );
  }

  const obligations = await storeObligations(store.id);
  const blockers = closureBlockers(obligations, w);
  const warnings = closureWarnings(obligations, w);
  const fresh = await signedInRecently();
  return (
    <div className="flex max-w-2xl flex-col gap-6">
      <PageHeader
        title={w.title}
        description={
          <>
            <span className="sm:hidden">{fillWords(w.phone.lead, { days: REOPEN_DAYS })}</span>
            <span className="max-sm:hidden">{fillWords(w.description, { days: REOPEN_DAYS })}</span>
          </>
        }
      />

      {blockers.length > 0 && (
        <section aria-labelledby="blockers" className="flex flex-col gap-2 rounded-panel bg-sunken p-4">
          <h2 id="blockers" className="text-title text-ink">
            {w.before}
          </h2>
          <ul className="list-disc pl-5 text-sm">
            {blockers.map((b) => (
              <li key={b}>{b}</li>
            ))}
          </ul>
          <Link href={`/admin/${store.slug}/orders`} className="self-start text-sm underline underline-offset-2 sm:hidden">
            {w.phone.seeOrders}
          </Link>
        </section>
      )}

      {/* Round 58: on a phone what closing does and the downloads are two rows of one card under the close; from sm up as before. */}
      <PhoneRows className="max-sm:order-last sm:contents">
        <PhoneRow title={w.what} sub={w.phone.whatSub} change={w.phone.open} done={w.phone.close}>
        <section aria-labelledby="warnings" className="flex flex-col gap-2">
          <h2 id="warnings" className="text-title text-ink max-sm:sr-only">
            {w.what}
          </h2>
          <ul className="list-disc pl-5 text-sm text-muted">
            {warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </section>
        </PhoneRow>
        <div className="sm:order-last">
          <PhoneRow flat last title={w.takeTitle} sub={w.phone.takeSub} change={w.phone.open} done={w.phone.close}>
            <TakeAway slug={store.slug} w={w} />
          </PhoneRow>
        </div>
      </PhoneRows>

      {blockers.length === 0 && !fresh && (
        <section aria-labelledby="signin" className={`flex flex-col gap-2 p-4 ${CARD_CLASS}`}>
          <h2 id="signin" className="text-title text-ink">
            {w.signInTitle}
          </h2>
          <p className="text-sm text-muted">{w.signInText}</p>
          <QuietActionForm action={signInAgainAction.bind(null, store.slug)}>
            <SubmitButton>{w.signIn}</SubmitButton>
          </QuietActionForm>
        </section>
      )}

      {blockers.length === 0 && fresh && (
        <ActionForm action={closeStoreAction.bind(null, store.slug)} className={`flex flex-col gap-3 p-4 ${CARD_CLASS}`} successMessage={w.closed}>
          <label className="flex flex-col gap-1 text-sm font-medium">
            <Confirm text={w.confirm} slug={store.slug} />
            <input name="address" required autoComplete="off" spellCheck={false} className={control} />
          </label>
          <div>
            <SubmitButton>{fillWords(w.closeNamed, { name: store.name })}</SubmitButton>
          </div>
        </ActionForm>
      )}
    </div>
  );
}

/** The whole store as one file (D377), and the CSV files of what has its own, so an owner can leave with everything. */
function TakeAway({ slug, w }: { slug: string; w: { takeTitle: string; takeText: string; takeButton: string; takeProducts: string; takeStock: string; takeOrders: string; takeCustomers: string } }) {
  const base = `/admin/${slug}`;
  return (
    <section aria-labelledby="take-away" className={`flex flex-col gap-3 p-4 ${CARD_CLASS}`}>
      <h2 id="take-away" className="text-title text-ink">
        {w.takeTitle}
      </h2>
      <p className="text-sm text-muted">{w.takeText}</p>
      <form method="post" action={`${base}/settings/close/export`}>
        <button type="submit" className="min-h-10 rounded-pill border border-edge bg-card px-4 text-sm">
          {w.takeButton}
        </button>
      </form>
      <p className="flex flex-wrap gap-x-3 text-sm">
        <Link href={`${base}/products/export`} className="underline underline-offset-2">{w.takeProducts}</Link>
        <Link href={`${base}/inventory/export`} className="underline underline-offset-2">{w.takeStock}</Link>
        <Link href={`${base}/orders/export`} className="underline underline-offset-2">{w.takeOrders}</Link>
        <Link href={`${base}/customers/export`} className="underline underline-offset-2">{w.takeCustomers}</Link>
      </p>
    </section>
  );
}

/** "Type the store's address, {address}, to confirm", with the address in code type. */
function Confirm({ text, slug }: { text: string; slug: string }) {
  const [before, after = ""] = text.split("{address}");
  return (
    <span>
      {before}
      <span className="font-mono">{slug}</span>
      {after}
    </span>
  );
}
