import type { Metadata } from "next";

import { AdminTextScope } from "@/components/admin/admin-text";
import { requireFeature } from "@/components/admin/feature-off";
import { OwnNumberCheckCard, ReadinessList, TaxProfileForm, TaxWarnings, type OwnNumberCheck } from "@/components/admin/tax-profile-form";
import { adminLangOf, ADMIN_LANG_FACTS } from "@/lib/admin-lang";
import { adminText, adminTexts } from "@/lib/admin-text";
import { featureOn } from "@/lib/store-features";
import { readiness } from "@/lib/tax-profile";
import { requirePermission } from "@/server/permissions";
import { taxProfileView } from "@/server/tax-profile";
import { PageHeader } from "@/components/admin/ui";

import { checkVatNumberAction, saveTaxProfileAction } from "./actions";

export const metadata: Metadata = { title: "Tax settings" };

const regionName = (code: string | null, locale: string): string | null => {
  if (!code) return null;
  try {
    return new Intl.DisplayNames([locale], { type: "region" }).of(code) ?? code;
  } catch {
    return code;
  }
};

/**
 * How the store charges VAT (D157, `docs/wave-1a-tax.md`): its VAT registration and number, where goods are sent from, its OSS
 * and IOSS registrations. Only owners open it. The numbers belong to this store and are never copied with it.
 */
export default async function TaxSettingsPage({ params }: PageProps<"/admin/[store]/settings/tax">) {
  const member = await requirePermission((await params).store, "owner");
  // Part of the online shop (D178 step 5): hidden while it is off, the store being a website.
  const shopOff = requireFeature(member, "shop");
  if (shopOff) return shopOff;
  const { store } = member;
  const lang = adminLangOf(member.account.adminLocale);
  const w = adminText(lang, "tax");
  const view = await taxProfileView(store.id);
  const lines = readiness(view.profile, view.country, w.readiness);
  const canEdit = true;
  // Reverse charge is for selling to businesses (D178): its readiness and words are hidden while that is switched off.
  const business = featureOn(store, "business");
  const check: OwnNumberCheck | null = view.check
    ? {
        status: view.check.status,
        source: view.check.source,
        checkedAt: view.check.requestedAt,
        requestIdentifier: view.check.requestIdentifier,
        name: view.check.name,
        address: view.check.address,
      }
    : null;
  return (
    <AdminTextScope texts={adminTexts(lang, ["tax"])}>
    <div className="flex flex-col gap-6">
      <PageHeader
        title={w.page.title}
        description={<>{w.page.intro}{" "}{business && w.page.reverseCharge}{w.page.notAdvice}</>}
      />
      <ReadinessList lines={business ? lines : lines.filter((line) => line.key !== "reverse_charge")} />
      <TaxProfileForm
        profile={view.profile}
        country={view.country}
        countryName={regionName(view.country, ADMIN_LANG_FACTS[lang].locale)}
        canEdit={canEdit}
        saveAction={saveTaxProfileAction.bind(null, store.slug)}
      />
      <OwnNumberCheckCard number={view.profile.vatNumber} check={check} canEdit={canEdit} action={checkVatNumberAction.bind(null, store.slug)} />
      <TaxWarnings warnings={w.warnings.items} />
    </div>
    </AdminTextScope>
  );
}
