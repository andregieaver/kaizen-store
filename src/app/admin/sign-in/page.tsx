import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { ActionForm, SubmitButton } from "@/components/admin/action-form";
import { PasswordField } from "@/components/admin/password-field";
import { AdminTextProvider } from "@/components/admin/admin-text";
import { signInEn } from "@/lib/admin-messages/sign-in.en";
import type { AdminLang } from "@/lib/admin-lang";
import { fillWords } from "@/lib/admin-fill";
import { adminText, adminTexts } from "@/lib/admin-text";
import { safeNext } from "@/lib/password";
import { requestAdminLang } from "@/server/admin-request-lang";
import { getAccount } from "@/server/auth";
import { kaizenLifeSignInOn } from "@/server/kaizen-life";
import { buttonClass, FocusFrame } from "@/components/admin/ui";

import { signIn, signInWithKaizenLife } from "./actions";

/** The tab's title stays fixed (in English): a title read from the request would stream the page's metadata, `noindex` with it, out of `<head>`. */
export const metadata: Metadata = { title: signInEn.titles.signIn };

/** Drawn in the request's language (D312 A1, `requestAdminLang()`), so the whole page waits for the request; an empty frame until then. */
export default function SignInPage({ searchParams }: PageProps<"/admin/sign-in">) {
  return (
    <Suspense fallback={<FocusFrame />}>
      <SignIn searchParams={searchParams} />
    </Suspense>
  );
}

async function SignIn({ searchParams }: { searchParams: PageProps<"/admin/sign-in">["searchParams"] }) {
  const lang = await requestAdminLang();
  const w = adminText(lang, "signIn").signIn;
  return (
    <AdminTextProvider lang={lang} texts={adminTexts(lang, ["common", "signIn"])}>
      <FocusFrame
        lang={lang}
        title={w.heading}
        aside={
          <Link href="/sign-up" className="underline-offset-2 hover:underline">
            {w.askForStore}
          </Link>
        }
      >
        <Notice searchParams={searchParams} lang={lang} />
        <KaizenLifeButton searchParams={searchParams} lang={lang} />
        <ActionForm action={signIn} className="flex flex-col gap-4">
          <NextField searchParams={searchParams} />
          <label className="flex flex-col gap-1 text-sm font-medium">
            {w.email}
            <input
              type="email"
              name="email"
              required
              autoComplete="username"
              className="min-h-10 rounded-md border border-line bg-card px-3 font-normal"
            />
          </label>
          <PasswordField
            label={w.password}
            autoComplete="current-password"
            aside={
              <Link href="/admin/forgot-password" className="underline">
                {w.forgot}
              </Link>
            }
          />
          <SubmitButton name="method" value="password">
            {w.submit}
          </SubmitButton>
          <div className="flex items-center gap-3 text-sm text-muted" aria-hidden>
            <span className="h-px flex-1 bg-line" />
            {w.or}
            <span className="h-px flex-1 bg-line" />
          </div>
          <SubmitButton name="method" value="link" variant="secondary" skipValidation>
            {w.emailLink}
          </SubmitButton>
        </ActionForm>
        <p className="text-body text-muted">
          {w.beta}{" "}
          <Link href="/sign-up" className="underline">
            {w.betaAsk}
          </Link>
          {w.betaInvite}
        </p>
      </FocusFrame>
    </AdminTextProvider>
  );
}

async function Notice({ searchParams, lang }: { searchParams: PageProps<"/admin/sign-in">["searchParams"]; lang: AdminLang }) {
  const { error, notice } = await searchParams;
  const w = adminText(lang, "signIn").signIn;
  const account = await getAccount();
  if (account) {
    return (
      <p className="text-sm">
        {fillWords(w.signedInAs, { email: account.email })}{" "}
        <Link href="/admin" className="underline">
          {w.goToAdmin}
        </Link>
      </p>
    );
  }
  const alert = {
    "no-access": w.noAccess,
    "owners-only": w.ownersOnly,
    "kaizen-life": w.kaizenLifeFailed,
    link: w.linkExpired,
  }[String(error)];
  if (notice === "recovered") {
    return (
      <p role="status" className="text-sm">
        {w.recovered}
      </p>
    );
  }
  return alert ? (
    <p role="alert" className="text-sm">
      {alert}
    </p>
  ) : null;
}

/** Where to go once signed in, such as back to a consent page (D95). */
async function NextField({ searchParams }: { searchParams: PageProps<"/admin/sign-in">["searchParams"] }) {
  const { next } = await searchParams;
  return typeof next === "string" ? <input type="hidden" name="next" value={safeNext(next)} /> : null;
}

/** Store owners can sign in with their Kaizen Life account (D95), once it is set up. */
async function KaizenLifeButton({ searchParams, lang }: { searchParams: PageProps<"/admin/sign-in">["searchParams"]; lang: AdminLang }) {
  const { next } = await searchParams;
  if (!kaizenLifeSignInOn()) return null;
  const w = adminText(lang, "signIn").signIn;
  return (
    <form action={signInWithKaizenLife} className="flex flex-col gap-2">
      {typeof next === "string" && <input type="hidden" name="next" value={safeNext(next)} />}
      <button type="submit" className={buttonClass("secondary", "card", true)}>
        {w.withKaizenLife}
      </button>
      <p className="text-xs text-muted">{w.kaizenLifeFor}</p>
    </form>
  );
}
