import type { Metadata } from "next";
import Link from "next/link";

import { ActionForm, SubmitButton } from "@/components/admin/action-form";

import { requestPasswordReset } from "../sign-in/actions";

export const metadata: Metadata = { title: "Forgot password" };

export default function ForgotPasswordPage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-6 px-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold">Choose a new password</h1>
        <p className="text-sm text-muted">
          Enter your email and we will send you a link. It signs you in and opens your account,
          where you choose the new password. This also works if you have never had a password.
        </p>
      </div>
      <ActionForm action={requestPasswordReset} replaceOnSuccess className="flex flex-col gap-3">
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
        <SubmitButton>Email me a link</SubmitButton>
      </ActionForm>
      <p className="text-sm">
        <Link href="/admin/sign-in" className="underline">
          Back to sign in
        </Link>
      </p>
    </main>
  );
}
