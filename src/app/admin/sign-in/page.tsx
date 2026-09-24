import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { ActionForm, SubmitButton } from "@/components/admin/action-form";
import { PasswordField } from "@/components/admin/password-field";
import { getAccount } from "@/server/auth";

import { signIn } from "./actions";

export const metadata: Metadata = { title: "Sign in" };

export default function SignInPage({ searchParams }: PageProps<"/admin/sign-in">) {
  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-6 px-6">
      <h1 className="text-2xl font-semibold">Sign in to Kaizen</h1>
      <Suspense fallback={null}>
        <Notice searchParams={searchParams} />
      </Suspense>
      <ActionForm action={signIn} className="flex flex-col gap-4">
        <label className="flex flex-col gap-1 text-sm font-medium">
          Email
          <input
            type="email"
            name="email"
            required
            autoComplete="username"
            className="min-h-10 rounded-md border border-border bg-background px-3 font-normal"
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
          <span className="h-px flex-1 bg-border" />
          or
          <span className="h-px flex-1 bg-border" />
        </div>
        <SubmitButton name="method" value="link" variant="secondary" skipValidation>
          Email me a sign-in link instead
        </SubmitButton>
      </ActionForm>
      <p className="text-sm text-muted">
        Kaizen is in a private beta: only invited accounts can sign in.{" "}
        <Link href="/sign-up" className="underline">
          Ask for a store
        </Link>
        , or ask a store&apos;s owner to invite you.
      </p>
    </main>
  );
}

async function Notice({ searchParams }: { searchParams: PageProps<"/admin/sign-in">["searchParams"] }) {
  const { error } = await searchParams;
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
  if (error === "no-access") {
    return <p role="alert" className="text-sm">That account does not have access yet.</p>;
  }
  if (error === "link") {
    return <p role="alert" className="text-sm">That link has expired or was already used. Request a new one.</p>;
  }
  return null;
}
