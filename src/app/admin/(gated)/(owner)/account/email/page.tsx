import type { Metadata } from "next";

import { ActionForm, SubmitButton } from "@/components/admin/action-form";
import { QuietActionForm } from "@/components/admin/quiet-action-form";
import { CARD_CLASS, Field, PageHeader, TextInput } from "@/components/admin/ui";
import { adminDate, PLATFORM_TIME_ZONE } from "@/lib/admin-date";
import { fillWords } from "@/lib/admin-fill";
import { adminLangOf } from "@/lib/admin-lang";
import { adminText } from "@/lib/admin-text";
import { requireAccount } from "@/server/auth";
import { freshness, pendingEmailChange } from "@/server/email-change";

import { cancelEmailChangeAction, requestEmailChangeAction, resendEmailChangeAction, signInForEmailAction } from "../actions";

export const metadata: Metadata = { title: "Change your email" };

/**
 * Changing one's own email (D836): the new address typed once, a link sent to it, the email changed when the link is opened. Asking needs a
 * sign-in from the last ten minutes (and the second step where the account has one), so a person who signed in earlier is asked to sign in
 * again first. Lisa's part is here, one step from Your account: the waiting change, its link sent again, or cancelled.
 */
export default async function AccountEmailPage() {
  const account = await requireAccount();
  const lang = adminLangOf(account.adminLocale);
  const w = adminText(lang, "bookings").account.email;
  const [pending, fresh] = await Promise.all([pendingEmailChange(account.id), freshness()]);
  const date = (iso: string) => adminDate(PLATFORM_TIME_ZONE, iso, "dayTime", lang);
  return (
    <div className="flex max-w-2xl flex-col gap-6">
      <PageHeader back={{ href: "/admin/account", label: w.back }} title={w.title} description={w.description} />
      <p className="text-body text-ink [overflow-wrap:anywhere]">{fillWords(w.current, { email: account.email })}</p>

      {pending && (
        <section aria-labelledby="pending-heading" className={`flex flex-col gap-3 p-4 ${CARD_CLASS}`} data-pending-change="">
          <h2 id="pending-heading" className="text-title text-ink">
            {w.pendingTitle}
          </h2>
          <p className="text-sm [overflow-wrap:anywhere]">
            {pending.expired
              ? fillWords(w.expiredText, { email: pending.email })
              : fillWords(w.pendingText, { email: pending.email, date: date(pending.createdAt), until: date(pending.expiresAt) })}
          </p>
          {pending.byAdmin && <p className="text-sm text-muted">{w.pendingByAdmin}</p>}
          <div className="flex flex-wrap gap-3">
            {fresh === "ok" && (
              <ActionForm action={resendEmailChangeAction}>
                <SubmitButton variant="secondary">{w.resend}</SubmitButton>
              </ActionForm>
            )}
            <QuietActionForm action={cancelEmailChangeAction}>
              <SubmitButton variant="secondary">{w.cancel}</SubmitButton>
            </QuietActionForm>
          </div>
        </section>
      )}

      {fresh !== "ok" ? (
        <section aria-labelledby="signin-heading" className={`flex flex-col gap-2 p-4 ${CARD_CLASS}`}>
          <h2 id="signin-heading" className="text-title text-ink">
            {w.signInTitle}
          </h2>
          <p className="text-sm text-muted">{fresh === "second_step" ? w.problems.second_step : w.signInText}</p>
          <QuietActionForm action={signInForEmailAction}>
            <SubmitButton>{w.signIn}</SubmitButton>
          </QuietActionForm>
        </section>
      ) : (
        <ActionForm action={requestEmailChangeAction} className="flex max-w-md flex-col gap-3">
          <Field label={w.newEmail} hint={w.newEmailHint} required>
            {(control) => <TextInput name="email" type="email" autoComplete="email" spellCheck={false} full {...control} />}
          </Field>
          <div>
            <SubmitButton>{w.send}</SubmitButton>
          </div>
        </ActionForm>
      )}
    </div>
  );
}
