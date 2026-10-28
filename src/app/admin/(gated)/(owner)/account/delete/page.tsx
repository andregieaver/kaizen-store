import type { Metadata } from "next";

import { ActionForm, SubmitButton } from "@/components/admin/action-form";
import { CARD_CLASS, PageHeader } from "@/components/admin/ui";
import { countWords } from "@/lib/admin-fill";
import { adminLangOf } from "@/lib/admin-lang";
import { adminText } from "@/lib/admin-text";
import { erasePreview } from "@/server/account-erasure";
import { requireAccount, signedInRecently } from "@/server/auth";

import { eraseAccountAction, signInAgainAction } from "./actions";

export const metadata: Metadata = { title: "Delete your account" };

/**
 * Deleting one's own account (wave 10 unit P, D377): what goes, or why it cannot go yet, then a fresh sign-in and the email typed again.
 * Every account may reach it; the server decides.
 */
export default async function DeleteAccountPage() {
  const account = await requireAccount();
  const w = adminText(adminLangOf(account.adminLocale), "bookings").account.erase;
  const [plan, fresh] = await Promise.all([erasePreview(account), signedInRecently()]);
  const [before, after = ""] = w.confirm.split("{email}");
  return (
    <div className="flex max-w-2xl flex-col gap-6">
      <PageHeader back={{ href: "/admin/account", label: w.back }} title={w.title} description={w.description} />
      {!plan.ok ? (
        <section aria-label={w.title} className="flex flex-col gap-2 rounded-panel bg-sunken p-4 text-sm">
          <p>{w.refusals[plan.refusal]}</p>
          {plan.stores && (
            <ul className="list-disc pl-5">
              {plan.stores.map((name) => (
                <li key={name}>{name}</li>
              ))}
            </ul>
          )}
        </section>
      ) : (
        <>
          <section aria-labelledby="goes" className="flex flex-col gap-2">
            <h2 id="goes" className="text-title text-ink">
              {w.goes}
            </h2>
            <ul className="list-disc pl-5 text-sm text-muted">
              <li>{countWords(plan.stores, w.memberships)}</li>
              <li>{countWords(plan.conversations, w.conversations)}</li>
              <li>{countWords(plan.memories, w.memories)}</li>
            </ul>
          </section>
          {!fresh ? (
            <section aria-labelledby="signin" className={`flex flex-col gap-2 p-4 ${CARD_CLASS}`}>
              <h2 id="signin" className="text-title text-ink">
                {w.signInTitle}
              </h2>
              <p className="text-sm text-muted">{w.signInText}</p>
              <form action={signInAgainAction}>
                <SubmitButton>{w.signIn}</SubmitButton>
              </form>
            </section>
          ) : (
            <ActionForm action={eraseAccountAction} className={`flex flex-col gap-3 p-4 ${CARD_CLASS}`}>
              <label className="flex flex-col gap-1 text-sm font-medium">
                <span>
                  {before}
                  <span className="font-mono">{account.email}</span>
                  {after}
                </span>
                <input name="email" type="email" required autoComplete="off" spellCheck={false} className="min-h-10 rounded-md border border-line bg-card px-3 font-normal" />
              </label>
              <div>
                <SubmitButton>{w.submit}</SubmitButton>
              </div>
            </ActionForm>
          )}
        </>
      )}
    </div>
  );
}
