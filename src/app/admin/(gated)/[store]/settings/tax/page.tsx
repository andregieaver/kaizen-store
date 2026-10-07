import type { Metadata } from "next";

import { OwnNumberCheckCard, ReadinessList, TaxProfileForm, TaxWarnings, type OwnNumberCheck } from "@/components/admin/tax-profile-form";
import { featureOn } from "@/lib/store-features";
import { TAX_WARNINGS } from "@/lib/tax-profile";
import { requirePermission } from "@/server/permissions";
import { taxProfileView } from "@/server/tax-profile";

import { checkVatNumberAction, saveTaxProfileAction } from "./actions";

export const metadata: Metadata = { title: "Tax settings" };

const regionName = (code: string | null): string | null => {
  if (!code) return null;
  try {
    return new Intl.DisplayNames(["en"], { type: "region" }).of(code) ?? code;
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
  const { store } = member;
  const view = await taxProfileView(store.id);
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
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Tax</h1>
        <p className="max-w-2xl text-sm text-muted">
          Prices in the store include VAT, and each sale is charged the VAT of the country it goes to. Here the store records its VAT registration and, where it has
          them, its OSS and IOSS registrations.{" "}
          {business &&
            "A business in another EU country that gives a valid VAT number can buy goods without VAT (reverse charge) once the store's own number has been checked. "}
          This is not tax advice.
        </p>
      </div>
      <ReadinessList lines={business ? view.readiness : view.readiness.filter((line) => line.key !== "reverse_charge")} />
      <TaxProfileForm
        profile={view.profile}
        country={view.country}
        countryName={regionName(view.country)}
        canEdit={canEdit}
        saveAction={saveTaxProfileAction.bind(null, store.slug)}
      />
      <OwnNumberCheckCard number={view.profile.vatNumber} check={check} canEdit={canEdit} action={checkVatNumberAction.bind(null, store.slug)} />
      <TaxWarnings warnings={TAX_WARNINGS} />
    </div>
  );
}
