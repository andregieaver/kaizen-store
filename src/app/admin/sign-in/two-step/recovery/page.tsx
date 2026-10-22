import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import { ActionForm, SubmitButton } from "@/components/admin/action-form";
import { AdminTextProvider } from "@/components/admin/admin-text";
import { FocusFrame, FocusHeading } from "@/components/admin/ui";
import { adminText, adminTexts } from "@/lib/admin-text";
import { safeNext } from "@/lib/password";
import { TWO_STEP_PATHS } from "@/lib/two-step";
import { requestAdminLang } from "@/server/admin-request-lang";
import { getAssurance } from "@/server/auth";
import { recoveryAvailable } from "@/server/recovery-codes";

import { recoveryCodeAction } from "../actions";

export async function generateMetadata(): Promise<Metadata> {
  return {
    title: adminText(await requestAdminLang(), "signIn").titles.recovery,
  };
}

/**
 * A recovery code in place of the authenticator app (wave 1, 1f). It works once, takes the second step away, ends every session and emails
 * the account; the person then signs in again and sets it up anew. Said plainly here, before the code is spent. In the account's language
 * (D312 A1).
 */
export default function RecoveryPage({ searchParams }: PageProps<"/admin/sign-in/two-step/recovery">) {
  return (
    <Suspense fallback={<FocusFrame />}>
      <Recovery searchParams={searchParams} />
    </Suspense>
  );
}

async function Recovery({ searchParams }: { searchParams: PageProps<"/admin/sign-in/two-step/recovery">["searchParams"] }) {
  const query = await searchParams;
  const next = safeNext(typeof query.next === "string" ? query.next : undefined);
  const held = await getAssurance();
  if (!held) redirect("/admin/sign-in");
  if (held.assurance.state !== "challenge") redirect(`${TWO_STEP_PATHS.challenge}?next=${encodeURIComponent(next)}`);
  const available = recoveryAvailable();
  const lang = await requestAdminLang();
  const w = adminText(lang, "signIn").recovery;
  return (
    <AdminTextProvider lang={lang} texts={adminTexts(lang, ["common", "signIn"])}>
      <FocusFrame lang={lang}>
        <FocusHeading title={w.heading} description={w.description} />
        {available ? (
          <ActionForm action={recoveryCodeAction} className="flex flex-col gap-4">
            <label className="flex flex-col gap-1 text-sm font-medium">
              {w.code}
              <input
                name="code"
                required
                autoFocus
                autoComplete="off"
                autoCapitalize="characters"
                spellCheck={false}
                maxLength={16}
                className="min-h-10 rounded-md border border-line bg-card px-3 font-mono text-lg font-normal tracking-wider uppercase"
              />
            </label>
            <SubmitButton>{w.submit}</SubmitButton>
          </ActionForm>
        ) : (
          <p role="alert" className="text-sm">
            {w.unavailable}
          </p>
        )}
        <p className="text-sm">
          <Link href={`${TWO_STEP_PATHS.challenge}?next=${encodeURIComponent(next)}`} className="underline">
            {w.back}
          </Link>
        </p>
      </FocusFrame>
    </AdminTextProvider>
  );
}
