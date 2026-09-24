import type { Metadata } from "next";
import Link from "next/link";

import { ActionForm, SubmitButton } from "@/components/admin/action-form";

import { requestAccess } from "./actions";

export const metadata: Metadata = {
  title: "Start your store",
  description: "Kaizen is in a private beta. Ask for a store and we will set one up for you.",
  alternates: { canonical: "/sign-up" },
};

const field = "flex flex-col gap-1 text-sm font-medium";
const control = "min-h-11 rounded-md border border-border bg-background px-3 font-normal";

export default function SignUpPage() {
  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center gap-6 px-6 py-16">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">Start your store</h1>
        <p className="mt-2 text-muted">
          Kaizen is in a private beta. Tell us who you are and we will set up your store, ready
          to try with demo products.
        </p>
      </div>
      <ActionForm action={requestAccess} className="flex flex-col gap-4" replaceOnSuccess>
        <label className={field}>
          Your name
          <input name="name" required autoComplete="name" className={control} />
        </label>
        <label className={field}>
          Email
          <input type="email" name="email" required autoComplete="email" className={control} />
        </label>
        <label className={field}>
          Store name
          <input name="storeName" required maxLength={80} autoComplete="organization" className={control} />
          <span className="font-normal text-muted">You can change it later.</span>
        </label>
        <label className={field}>
          <span>
            What will you sell? <span className="font-normal text-muted">(optional)</span>
          </span>
          <textarea name="message" rows={3} maxLength={1000} className={`${control} py-2`} />
        </label>
        {/* Hidden from people and screen readers; a filled-in value marks a bot. */}
        <div aria-hidden="true" className="hidden">
          <label>
            Website
            <input name="website" tabIndex={-1} autoComplete="off" />
          </label>
        </div>
        <div>
          <SubmitButton>Request a store</SubmitButton>
        </div>
      </ActionForm>
      <p className="text-sm text-muted">
        Already have an account?{" "}
        <Link href="/admin/sign-in" className="underline">
          Sign in
        </Link>
      </p>
    </main>
  );
}
