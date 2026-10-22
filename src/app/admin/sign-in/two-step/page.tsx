import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import { ActionForm, SubmitButton } from "@/components/admin/action-form";
import { AdminTextProvider } from "@/components/admin/admin-text";
import { FocusFrame, FocusHeading } from "@/components/admin/ui";
import { signInEn } from "@/lib/admin-messages/sign-in.en";
import type { AdminLang } from "@/lib/admin-lang";
import { adminText, adminTexts } from "@/lib/admin-text";
import { safeNext } from "@/lib/password";
import { TWO_STEP_PATHS, heldPath } from "@/lib/two-step";
import { requestAdminLang } from "@/server/admin-request-lang";
import { getAssurance } from "@/server/auth";

import { leaveTwoStepAction, verifyTwoStepAction } from "./actions";

/** The tab's title stays fixed (in English): a title read from the request would stream the page's metadata, `noindex` with it, out of `<head>`. */
export const metadata: Metadata = { title: signInEn.titles.twoStep };

/**
 * The second step of signing in (wave 1, 1f, docs/wave-1-trust.md 2.6): the six digits from the authenticator app. Outside the gated
 * area, so a person who has not passed it can reach it; whoever should not be here is sent on: nobody signed in to sign in, someone
 * who has to set it up to the set-up page, someone who has already passed it to where they were going. In the account's language
 * (D312 A1).
 */
export default function TwoStepPage({ searchParams }: PageProps<"/admin/sign-in/two-step">) {
  return (
    <Suspense fallback={<FocusFrame />}>
      <Challenge searchParams={searchParams} />
    </Suspense>
  );
}

async function Challenge({ searchParams }: { searchParams: PageProps<"/admin/sign-in/two-step">["searchParams"] }) {
  const query = await searchParams;
  const next = safeNext(typeof query.next === "string" ? query.next : undefined);
  const held = await getAssurance();
  if (!held) redirect("/admin/sign-in");
  const { assurance } = held;
  if (assurance.state === "enrol") redirect(heldPath(assurance, next) ?? TWO_STEP_PATHS.enrol);
  if (assurance.state === "ok" || assurance.state === "off") redirect(next);
  const lang = await requestAdminLang();
  const w = adminText(lang, "signIn").twoStep;

  if (assurance.state === "unknown") {
    return (
      <FocusFrame lang={lang}>
        <FocusHeading title={w.uncheckedTitle} />
        <p role="alert" className="text-sm">
          {w.uncheckedText}
        </p>
        <p className="text-sm">
          <Link href={`${TWO_STEP_PATHS.challenge}?next=${encodeURIComponent(next)}`} className="underline">
            {w.tryAgain}
          </Link>
        </p>
        <SignOut lang={lang} />
      </FocusFrame>
    );
  }

  return (
    <AdminTextProvider lang={lang} texts={adminTexts(lang, ["common", "signIn"])}>
      <FocusFrame lang={lang}>
        <FocusHeading title={w.heading} description={w.description} />
        <ActionForm action={verifyTwoStepAction.bind(null, next)} className="flex flex-col gap-4">
          <label className="flex flex-col gap-1 text-sm font-medium">
            {w.code}
            <input
              name="code"
              required
              autoFocus
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9 ]*"
              maxLength={7}
              className="min-h-10 rounded-md border border-line bg-card px-3 text-lg font-normal tracking-widest tabular-nums"
            />
          </label>
          <SubmitButton>{w.submit}</SubmitButton>
        </ActionForm>
        <p className="text-sm">
          <Link href={`${TWO_STEP_PATHS.recovery}?next=${encodeURIComponent(next)}`} className="underline">
            {w.useRecovery}
          </Link>{" "}
          <span className="text-muted">{w.lostPhone}</span>
        </p>
        <SignOut lang={lang} />
      </FocusFrame>
    </AdminTextProvider>
  );
}

function SignOut({ lang }: { lang: AdminLang }) {
  return (
    <form action={leaveTwoStepAction}>
      <button type="submit" className="text-sm underline">
        {adminText(lang, "signIn").twoStep.signOut}
      </button>
    </form>
  );
}
