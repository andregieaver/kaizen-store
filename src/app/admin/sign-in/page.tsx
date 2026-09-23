import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { ActionForm, SubmitButton } from "@/components/admin/action-form";
import { getStaff } from "@/server/auth";

import { requestSignInLink } from "./actions";

export const metadata: Metadata = { title: "Sign in" };

export default function SignInPage({ searchParams }: PageProps<"/admin/sign-in">) {
  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-6 px-6">
      <h1 className="text-2xl font-semibold">Kaizen Store admin</h1>
      <Suspense fallback={null}>
        <Notice searchParams={searchParams} />
      </Suspense>
      <ActionForm action={requestSignInLink} className="flex flex-col gap-3">
        <label className="flex flex-col gap-1 text-sm font-medium">
          Email
          <input
            type="email"
            name="email"
            required
            autoComplete="email"
            className="min-h-10 rounded-md border border-border bg-background px-3 font-normal"
          />
        </label>
        <SubmitButton>Send sign-in link</SubmitButton>
      </ActionForm>
      <p className="text-sm text-muted">
        Only invited staff can sign in. Ask a store owner for access.
      </p>
    </main>
  );
}

async function Notice({ searchParams }: { searchParams: PageProps<"/admin/sign-in">["searchParams"] }) {
  const { error } = await searchParams;
  const staff = await getStaff();
  if (staff) {
    return (
      <p className="text-sm">
        You are signed in as {staff.email}.{" "}
        <Link href="/admin" className="underline">
          Go to the admin
        </Link>
      </p>
    );
  }
  if (error === "no-access") {
    return <p role="alert" className="text-sm">That account does not have access to this store&apos;s admin.</p>;
  }
  if (error === "link") {
    return <p role="alert" className="text-sm">That sign-in link has expired or was already used. Request a new one.</p>;
  }
  return null;
}
