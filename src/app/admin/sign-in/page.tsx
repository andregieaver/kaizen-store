import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { ActionForm, SubmitButton } from "@/components/admin/action-form";
import { PasswordField } from "@/components/admin/password-field";
import { safeNext } from "@/lib/password";
import { getAccount } from "@/server/auth";
import { kaizenLifeSignInOn } from "@/server/kaizen-life";
import { buttonClass, FocusFrame } from "@/components/admin/ui";

import { signIn, signInWithKaizenLife } from "./actions";

export const metadata: Metadata = { title: "Sign in" };

export default function SignInPage({ searchParams }: PageProps<"/admin/sign-in">) {
  return (
    <FocusFrame
      title="Sign in to Kaizen"
      aside={
        <Link href="/sign-up" className="underline-offset-2 hover:underline">
          Ask for a store
        </Link>
      }
    >
      <Suspense fallback={null}>
        <Notice searchParams={searchParams} />
      </Suspense>
      <Suspense fallback={null}>
        <KaizenLifeButton searchParams={searchParams} />
      </Suspense>
      <ActionForm action={signIn} className="flex flex-col gap-4">
        <Suspense fallback={null}>
          <NextField searchParams={searchParams} />
        </Suspense>
        <label className="flex flex-col gap-1 text-sm font-medium">
          Email
          <input
            type="email"
            name="email"
            required
            autoComplete="username"
            className="min-h-10 rounded-md border border-line bg-card px-3 font-normal"
          />
        </label>
        <PasswordField
          label="Password"
          autoComplete="current-password"
          aside={
            <Link href="/admin/forgot-password" className="underline">
              Forgot password?
            </Link>
          }
        />
        <SubmitButton name="method" value="password">
          Sign in
        </SubmitButton>
        <div className="flex items-center gap-3 text-sm text-muted" aria-hidden>
          <span className="h-px flex-1 bg-line" />
          or
          <span className="h-px flex-1 bg-line" />
        </div>
        <SubmitButton name="method" value="link" variant="secondary" skipValidation>
          Email me a sign-in link instead
        </SubmitButton>
      </ActionForm>
      <p className="text-body text-muted">
        Kaizen is in a private beta: only invited accounts can sign in.{" "}
        <Link href="/sign-up" className="underline">
          Ask for a store
        </Link>
        , or ask a store&apos;s owner to invite you.
      </p>
    </FocusFrame>
  );
}

async function Notice({ searchParams }: { searchParams: PageProps<"/admin/sign-in">["searchParams"] }) {
  const { error, notice } = await searchParams;
  const account = await getAccount();
  if (account) {
    return (
      <p className="text-sm">
        You are signed in as {account.email}.{" "}
        <Link href="/admin" className="underline">
          Go to the admin
        </Link>
      </p>
    );
  }
  if (notice === "recovered") {
    return (
      <p role="status" className="text-sm">
        Your recovery code worked, and your two-step sign-in was taken away. Sign in again: you will be asked to set it up once more.
      </p>
    );
  }
  if (error === "no-access") {
    return <p role="alert" className="text-sm">That account does not have access yet.</p>;
  }
  if (error === "owners-only") {
    return <p role="alert" className="text-sm">Signing in with Kaizen Life is for store owners. Sign in with your email instead.</p>;
  }
  if (error === "kaizen-life") {
    return <p role="alert" className="text-sm">Kaizen Life did not sign you in. Try again, or sign in with your email.</p>;
  }
  if (error === "link") {
    return <p role="alert" className="text-sm">That link has expired or was already used. Request a new one.</p>;
  }
  return null;
}

/** Where to go once signed in, such as back to a consent page (D95). */
async function NextField({ searchParams }: { searchParams: PageProps<"/admin/sign-in">["searchParams"] }) {
  const { next } = await searchParams;
  return typeof next === "string" ? <input type="hidden" name="next" value={safeNext(next)} /> : null;
}

/** Store owners can sign in with their Kaizen Life account (D95), once it is set up. */
async function KaizenLifeButton({ searchParams }: { searchParams: PageProps<"/admin/sign-in">["searchParams"] }) {
  const { next } = await searchParams;
  if (!kaizenLifeSignInOn()) return null;
  return (
    <form action={signInWithKaizenLife} className="flex flex-col gap-2">
      {typeof next === "string" && <input type="hidden" name="next" value={safeNext(next)} />}
      <button type="submit" className={buttonClass("secondary", "card", true)}>
        Sign in with Kaizen Life
      </button>
      <p className="text-xs text-muted">For store owners with a Kaizen Life account.</p>
    </form>
  );
}
