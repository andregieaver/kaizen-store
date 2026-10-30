import type { Metadata } from "next";
import { Suspense } from "react";

import { ActionForm, SubmitButton } from "@/components/admin/action-form";
import { AdminTextProvider } from "@/components/admin/admin-text-context";
import { FocusFrame } from "@/components/admin/ui";
import { signInEn } from "@/lib/admin-messages/sign-in.en";
import { adminText, adminTexts } from "@/lib/admin-text";
import { requestAdminLang } from "@/server/admin-request-lang";

import { requestPasswordReset } from "../sign-in/actions";

/** The tab's title stays fixed (in English): a title read from the request would stream the page's metadata, `noindex` with it, out of `<head>`. */
export const metadata: Metadata = { title: signInEn.titles.forgot };

/** In the request's language (D312 A1), so it waits for the request; an empty frame until then. */
export default function ForgotPasswordPage() {
  return (
    <Suspense fallback={<FocusFrame />}>
      <ForgotPassword />
    </Suspense>
  );
}

async function ForgotPassword() {
  const lang = await requestAdminLang();
  const w = adminText(lang, "signIn").forgot;
  return (
    <AdminTextProvider lang={lang} texts={adminTexts(lang, ["common", "signIn"])}>
      <FocusFrame lang={lang} back={{ href: "/admin/sign-in", label: w.back }} title={w.heading} description={w.description}>
        <ActionForm action={requestPasswordReset} replaceOnSuccess className="flex flex-col gap-3">
          <label className="flex flex-col gap-1 text-sm font-medium">
            {w.email}
            <input
              type="email"
              name="email"
              required
              autoComplete="username"
              className="min-h-10 rounded-md border border-line bg-card px-3 font-normal"
            />
          </label>
          <SubmitButton>{w.submit}</SubmitButton>
        </ActionForm>
      </FocusFrame>
    </AdminTextProvider>
  );
}
