import type { Metadata } from "next";

import { ActionForm, SubmitButton } from "@/components/admin/action-form";
import { PasswordField } from "@/components/admin/password-field";
import { MIN_PASSWORD_LENGTH } from "@/lib/password";
import { requireAccount } from "@/server/auth";

import { setPasswordAction } from "./actions";

export const metadata: Metadata = { title: "Your account" };

export default async function AccountPage() {
  const account = await requireAccount();
  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-8 px-4 py-8">
      <div>
        <h1 className="text-2xl font-semibold">Your account</h1>
        <p className="text-sm text-muted">
          Signed in as {account.name ? `${account.name} (${account.email})` : account.email}.
        </p>
      </div>

      <section aria-labelledby="password-heading" className="flex max-w-md flex-col gap-3">
        <h2 id="password-heading" className="font-medium">
          Password
        </h2>
        <p className="text-sm text-muted">
          Set a password to sign in without waiting for an email. You can still use a sign-in
          link whenever you like.
        </p>
        <ActionForm action={setPasswordAction} replaceOnSuccess className="flex flex-col gap-3">
          {/* Lets password managers save the new password with the right email. */}
          <input
            type="email"
            name="username"
            autoComplete="username"
            value={account.email}
            readOnly
            hidden
          />
          <PasswordField
            label="New password"
            autoComplete="new-password"
            minLength={MIN_PASSWORD_LENGTH}
            hint={`At least ${MIN_PASSWORD_LENGTH} characters. A few unrelated words make a strong, memorable password.`}
          />
          <div>
            <SubmitButton>Save password</SubmitButton>
          </div>
        </ActionForm>
      </section>
    </main>
  );
}
