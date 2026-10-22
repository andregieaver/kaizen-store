import type { Metadata } from "next";
import Link from "next/link";

import { ActionForm, SubmitButton } from "@/components/admin/action-form";
import { fillWords } from "@/lib/admin-fill";
import { ADMIN_LANG_FACTS, adminLangOf } from "@/lib/admin-lang";
import { adminText } from "@/lib/admin-text";
import { REOPEN_DAYS, closureBlockers, closureWarnings, ownerMayReopen, reopenDeadline } from "@/lib/store-closure";
import { signedInRecently } from "@/server/auth";
import { requireOwnerRole } from "@/server/permissions";
import { storeObligations, storeState } from "@/server/store-closure";
import { CARD_CLASS, PageHeader } from "@/components/admin/ui";

import { closeStoreAction, reopenStoreAction, signInAgainAction } from "./actions";

export const metadata: Metadata = { title: "Close store" };

const control = "min-h-10 rounded-md border border-line bg-card px-3 font-normal";
const day = (date: Date, locale: string) => date.toLocaleDateString(locale, { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });

/** Closing the store, or what a store that is closed or suspended can still do (D171). Owners only. */
export default async function CloseStorePage({ params }: PageProps<"/admin/[store]/settings/close">) {
  const member = await requireOwnerRole((await params).store);
  const { store } = member;
  const lang = adminLangOf(member.account.adminLocale);
  const locale = ADMIN_LANG_FACTS[lang].locale;
  const w = adminText(lang, "settings").close;
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
            {fillWords(mayReopen ? w.mayReopen : w.reopenEnded, { date: day(reopenDeadline(state.closedAt), locale) })}
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
      <PageHeader title={w.title} description={<>{fillWords(w.description, { days: REOPEN_DAYS })}</>} />

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
        </section>
      )}

      <section aria-labelledby="warnings" className="flex flex-col gap-2">
        <h2 id="warnings" className="text-title text-ink">
          {w.what}
        </h2>
        <ul className="list-disc pl-5 text-sm text-muted">
          {warnings.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      </section>

      {blockers.length === 0 && !fresh && (
        <section aria-labelledby="signin" className={`flex flex-col gap-2 p-4 ${CARD_CLASS}`}>
          <h2 id="signin" className="text-title text-ink">
            {w.signInTitle}
          </h2>
          <p className="text-sm text-muted">{w.signInText}</p>
          <form action={signInAgainAction.bind(null, store.slug)}>
            <SubmitButton>{w.signIn}</SubmitButton>
          </form>
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
