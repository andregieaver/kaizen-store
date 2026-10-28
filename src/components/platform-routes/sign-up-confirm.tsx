import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { ActionForm, SubmitButton } from "@/components/admin/action-form";
import { confirmSignup } from "@/app/(platform)/sign-up/actions";
import { PLATFORM_LANG_FACTS, platformPath, type PlatformLang } from "@/lib/platform-lang";
import { platformText } from "@/lib/platform-text";
import { confirmationOf } from "@/server/self-signup";

/** The confirmation page's head: never indexed, and the link's token never leaves in a referrer. */
export function signUpConfirmMetadata(lang: PlatformLang): Metadata {
  return { title: platformText(lang).signUp.selfServe.confirmTitle, robots: { index: false, follow: false }, referrer: "no-referrer" };
}

/**
 * The page a self-serve sign-up's email opens (D359): a button, so a mail scanner opening the link makes nothing. Read per request in its
 * `<Suspense>`; a link that does not work says so and points back to sign-up.
 */
export function SignUpConfirmRoute({ lang, params }: { lang: PlatformLang; params: Promise<{ token: string }> }) {
  const w = platformText(lang).signUp.selfServe;
  return (
    <main id="main" className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center gap-6 px-6 py-16">
      <h1 className="text-3xl font-semibold tracking-tight">{w.confirmTitle}</h1>
      <Suspense fallback={<div className="h-24 animate-pulse rounded-lg bg-surface" />}>
        <Confirm lang={lang} params={params} />
      </Suspense>
    </main>
  );
}

async function Confirm({ lang, params }: { lang: PlatformLang; params: Promise<{ token: string }> }) {
  const { token } = await params;
  const w = platformText(lang).signUp.selfServe;
  const found = await confirmationOf(token);
  if (!found) {
    return (
      <p role="alert">
        {w.unknown}{" "}
        <Link href={platformPath(lang, "/sign-up")} className="underline">
          {platformText(lang).signUp.title}
        </Link>
      </p>
    );
  }
  return (
    <ActionForm action={confirmSignup} className="flex flex-col gap-4" replaceOnSuccess>
      <input type="hidden" name="token" value={token} />
      <input type="hidden" name="locale" value={PLATFORM_LANG_FACTS[lang].locale} />
      <p>{w.confirmBody.replaceAll("{store}", found.storeName)}</p>
      <label className="flex flex-col gap-1 text-sm font-medium">
        {w.passwordLabel}
        <input
          type="password"
          name="password"
          autoComplete="new-password"
          maxLength={200}
          aria-describedby="signup-password-hint"
          className="min-h-11 rounded-md border border-border bg-background px-3 text-base font-normal"
        />
        <span id="signup-password-hint" className="font-normal text-muted">
          {w.passwordHint}
        </span>
      </label>
      <div>
        <SubmitButton>{w.confirmButton}</SubmitButton>
      </div>
    </ActionForm>
  );
}
