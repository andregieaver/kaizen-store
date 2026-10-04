import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import { ActionForm, SubmitButton } from "@/components/admin/action-form";
import { safeNext } from "@/lib/password";
import { TWO_STEP_PATHS } from "@/lib/two-step";
import { getAssurance } from "@/server/auth";
import { recoveryAvailable } from "@/server/recovery-codes";

import { recoveryCodeAction } from "../actions";

export const metadata: Metadata = { title: "Use a recovery code" };

/**
 * A recovery code in place of the authenticator app (wave 1, 1f). It works once, takes the second step away, ends every session and emails
 * the account; the person then signs in again and sets it up anew. Said plainly here, before the code is spent.
 */
export default function RecoveryPage({ searchParams }: PageProps<"/admin/sign-in/two-step/recovery">) {
  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-6 px-6">
      <Suspense fallback={<p className="text-sm text-muted">Loading …</p>}>
        <Recovery searchParams={searchParams} />
      </Suspense>
    </main>
  );
}

async function Recovery({ searchParams }: { searchParams: PageProps<"/admin/sign-in/two-step/recovery">["searchParams"] }) {
  const query = await searchParams;
  const next = safeNext(typeof query.next === "string" ? query.next : undefined);
  const held = await getAssurance();
  if (!held) redirect("/admin/sign-in");
  if (held.assurance.state !== "challenge") redirect(`${TWO_STEP_PATHS.challenge}?next=${encodeURIComponent(next)}`);
  const available = recoveryAvailable();
  return (
    <>
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold">Use a recovery code</h1>
        <p className="text-sm text-muted">
          Type one of the ten recovery codes you saved when you set up two-step sign-in, like K7QM2-9WXDB. Each works once. Using one takes your
          two-step sign-in away and signs you out everywhere, and we email you to say so. You then sign in again and set it up anew.
        </p>
      </div>
      {available ? (
        <ActionForm action={recoveryCodeAction} className="flex flex-col gap-4">
          <label className="flex flex-col gap-1 text-sm font-medium">
            Recovery code
            <input
              name="code"
              required
              autoFocus
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              maxLength={16}
              className="min-h-10 rounded-md border border-border bg-background px-3 font-mono text-lg font-normal tracking-wider uppercase"
            />
          </label>
          <SubmitButton>Use this code</SubmitButton>
        </ActionForm>
      ) : (
        <p role="alert" className="text-sm">
          Recovery is not available on this server. Ask a platform admin to reset your two-step sign-in.
        </p>
      )}
      <p className="text-sm">
        <Link href={`${TWO_STEP_PATHS.challenge}?next=${encodeURIComponent(next)}`} className="underline">
          Back to the code from my app
        </Link>
      </p>
    </>
  );
}
