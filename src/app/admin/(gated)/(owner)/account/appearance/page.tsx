import type { Metadata } from "next";

import { AppearanceField } from "@/components/admin/admin-colors";
import { SchemeField } from "@/components/admin/admin-scheme";
import { SchemePreview } from "@/components/admin/scheme-preview";
import { PageHeader } from "@/components/admin/ui";
import { offeredSchemes } from "@/lib/admin-schemes";
import { requireAccount } from "@/server/auth";
import { adminLangOf } from "@/lib/admin-lang";
import { adminText } from "@/lib/admin-text";

import { adminSchemeAction, colorModeAction } from "../actions";

export const metadata: Metadata = { title: "Appearance" };

/**
 * How the admin looks for the person (D99, D221, D222; docs/admin-style.md 7.1 and 7.3): light or dark, the colour scheme, and every
 * scheme drawn in both modes side by side with every component, so a scheme can be judged before it is chosen and a new one checked by
 * eye before it is offered. The choices are the account's; stores keep the colours set under Design.
 */
export default async function AppearancePage() {
  const account = await requireAccount();
  const previewWords = adminText(adminLangOf(account.adminLocale), "bookings").schemePreview;
  const schemes = offeredSchemes();
  return (
    <div className="flex flex-col gap-10">
      <PageHeader title="Appearance" meta={["How the admin looks for you", "Your stores keep the colours set under Design"]} />

      <div className="grid gap-8 md:grid-cols-2">
        <section aria-labelledby="mode-heading" className="flex flex-col gap-3">
          <h2 id="mode-heading" className="text-title text-ink">
            Light or dark
          </h2>
          <AppearanceField saved={account.colorMode ?? "system"} save={colorModeAction} />
        </section>
        <section aria-labelledby="scheme-heading" className="flex flex-col gap-3">
          <h2 id="scheme-heading" className="text-title text-ink">
            Colour scheme
          </h2>
          <SchemeField saved={account.adminScheme ?? "meadow"} save={adminSchemeAction} />
        </section>
      </div>

      <section aria-labelledby="every-heading" className="flex flex-col gap-6">
        <div>
          <h2 id="every-heading" className="text-title text-ink">
            Every scheme
          </h2>
          <p className="mt-1 text-body text-muted">
            Each scheme in light and in dark, with the admin&apos;s buttons, labels, cards, figures, bars and lists. The names and figures in them are examples.
          </p>
        </div>
        {schemes.map((scheme) => (
          <div key={scheme.id} className="grid gap-6 xl:grid-cols-2">
            <SchemePreview scheme={scheme} mode="light" words={previewWords} />
            <SchemePreview scheme={scheme} mode="dark" words={previewWords} />
          </div>
        ))}
      </section>
    </div>
  );
}
