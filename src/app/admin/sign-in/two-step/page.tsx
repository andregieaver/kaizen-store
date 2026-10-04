import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import { ActionForm, SubmitButton } from "@/components/admin/action-form";
import { safeNext } from "@/lib/password";
import { TWO_STEP_PATHS, heldPath } from "@/lib/two-step";
import { getAssurance } from "@/server/auth";

import { leaveTwoStepAction, verifyTwoStepAction } from "./actions";

export const metadata: Metadata = { title: "Two-step sign-in" };

/**
 * The second step of signing in (wave 1, 1f, docs/wave-1-trust.md 2.6): the six digits from the authenticator app. Outside the gated
 * area, so a person who has not passed it can reach it; whoever should not be here is sent on: nobody signed in to sign in, someone
 * who has to set it up to the set-up page, someone who has already passed it to where they were going.
 */
export default function TwoStepPage({ searchParams }: PageProps<"/admin/sign-in/two-step">) {
  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-6 px-6">
      <Suspense fallback={<p className="text-sm text-muted">Loading …</p>}>
        <Challenge searchParams={searchParams} />
      </Suspense>
    </main>
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

  if (assurance.state === "unknown") {
    return (
      <>
        <h1 className="text-2xl font-semibold">We could not check your sign-in</h1>
        <p role="alert" className="text-sm">
          We could not check your two-step status. Try again.
        </p>
        <p className="text-sm">
          <Link href={`${TWO_STEP_PATHS.challenge}?next=${encodeURIComponent(next)}`} className="underline">
            Try again
          </Link>
        </p>
        <SignOut />
      </>
    );
  }

  return (
    <>
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold">Two-step sign-in</h1>
        <p className="text-sm text-muted">Open your authenticator app and type the six-digit code it shows for Kaizen Store.</p>
      </div>
      <ActionForm action={verifyTwoStepAction.bind(null, next)} className="flex flex-col gap-4">
        <label className="flex flex-col gap-1 text-sm font-medium">
          Code
          <input
            name="code"
            required
            autoFocus
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9 ]*"
            maxLength={7}
            className="min-h-10 rounded-md border border-border bg-background px-3 text-lg font-normal tracking-widest tabular-nums"
          />
        </label>
        <SubmitButton>Continue</SubmitButton>
      </ActionForm>
      <p className="text-sm">
        <Link href={`${TWO_STEP_PATHS.recovery}?next=${encodeURIComponent(next)}`} className="underline">
          Use a recovery code
        </Link>{" "}
        <span className="text-muted">if you have lost your phone.</span>
      </p>
      <SignOut />
    </>
  );
}

function SignOut() {
  return (
    <form action={leaveTwoStepAction}>
      <button type="submit" className="text-sm underline">
        Sign out
      </button>
    </form>
  );
}
