import type { Metadata } from "next";
import { Suspense } from "react";

import { AdminLangSync, AdminTextProvider } from "@/components/admin/admin-text";
import { adminTexts } from "@/lib/admin-text";
import { requestAdminLang } from "@/server/admin-request-lang";

export const metadata: Metadata = { robots: { index: false, follow: false }, referrer: "no-referrer" };

/**
 * The page builder's sandbox (D456, `docs/builder-sandbox.md`): outside the signed-in admin's gate, so a visitor without an account reaches
 * it; every page under it opens its sandbox with the pass (`sandboxFor()`), never a session. The admin's root layout gives its look; this
 * gives its words, in the signed-in account's language if there is one, else the browser's.
 */
export default function TryLayout({ children }: LayoutProps<"/admin/try">) {
  return (
    <Suspense fallback={null}>
      <Words>{children}</Words>
    </Suspense>
  );
}

async function Words({ children }: { children: React.ReactNode }) {
  const lang = await requestAdminLang();
  return (
    <AdminTextProvider lang={lang} texts={adminTexts(lang, ["common", "shell", "sandbox"])}>
      <AdminLangSync lang={lang} />
      {children}
    </AdminTextProvider>
  );
}
