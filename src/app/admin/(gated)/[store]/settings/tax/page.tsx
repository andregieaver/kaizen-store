import type { Metadata } from "next";

import { AdminTextScope } from "@/components/admin/admin-text";
import { requireFeature } from "@/components/admin/feature-off";
import { FoldRow } from "@/components/admin/fold-row";
import { OwnNumberCheckCard, TaxProfileForm, TaxWarnings, type OwnNumberCheck, type TaxPart } from "@/components/admin/tax-profile-form";
import { countWords, fillWords } from "@/lib/admin-fill";
import { adminLangOf, ADMIN_LANG_FACTS } from "@/lib/admin-lang";
import { adminText, adminTexts } from "@/lib/admin-text";
import { featureOn } from "@/lib/store-features";
import { readiness } from "@/lib/tax-profile";
import { requirePermission } from "@/server/permissions";
import { taxProfileView } from "@/server/tax-profile";
import { CARD_CLASS, PageHeader } from "@/components/admin/ui";

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
  const { profile } = view;
  const locale = ADMIN_LANG_FACTS[lang].locale;
  const lead = !profile.vatRegistered ? w.page.leadOff : profile.vatNumber ? fillWords(w.page.leadOn, { number: profile.vatNumber }) : w.page.leadOnNoNumber;
  const vatSub = !profile.vatRegistered
    ? w.page.vatOff
    : !profile.vatNumber
      ? w.page.vatNoNumber
      : fillWords(profile.vatNumberValid === true ? w.page.vatValid : w.page.vatNotValid, { number: profile.vatNumber });
  const ossSub =
    profile.ossScheme === "none"
      ? w.page.ossOff
      : fillWords(w.page.ossOn, { scheme: w.schemes[profile.ossScheme].label, state: regionName(profile.ossMemberState, locale) ?? profile.ossNumber ?? "" }).replace(/ · $/, "");
  const iossSub = profile.iossNumber ? countWords(profile.iossMarkets.length, w.page.iossOn, { number: profile.iossNumber }) : w.page.iossOff;
  const reverse = lines.find((line) => line.key === "reverse_charge");
  const form = (part: TaxPart) => (
    <TaxProfileForm
      profile={profile}
      country={view.country}
      countryName={regionName(view.country, locale)}
      canEdit={canEdit}
      saveAction={saveTaxProfileAction.bind(null, store.slug)}
      part={part}
    />
  );
  return (
    <AdminTextScope texts={adminTexts(lang, ["tax"])}>
    <div className="flex flex-col gap-6">
      <PageHeader
        title={w.page.title}
        meta={[lead]}
        description={<>{w.page.leadRest}{business && w.page.reverseCharge}{w.page.notAdvice}</>}
      />
      {/* Round 15 (D647): each registration a row with what is true; Change opens its own form, which keeps the other parts as saved. */}
      <section aria-labelledby="regs" className={`px-6 py-2 ${CARD_CLASS}`}>
        <h2 id="regs" className="mt-3 mb-1 text-title text-ink">
          {w.page.rows}
        </h2>
        <ul className="divide-y divide-line">
          <FoldRow title={w.readiness.names.vat} sub={vatSub} action={profile.vatRegistered ? w.page.change : w.page.add}>
            <div className="flex flex-col gap-4">
              {form("vat")}
              <OwnNumberCheckCard number={profile.vatNumber} check={check} canEdit={canEdit} action={checkVatNumberAction.bind(null, store.slug)} />
            </div>
          </FoldRow>
          <FoldRow title={w.form.ossTitle} sub={ossSub} action={w.page.change}>
            {form("oss")}
          </FoldRow>
          <FoldRow title={w.form.iossTitle} sub={iossSub} action={w.page.change}>
            {form("ioss")}
          </FoldRow>
          {business && reverse && (
            <FoldRow title={w.readiness.names.reverse_charge} sub={reverse.on ? w.readiness.onText.reverse_charge : `${w.readiness.off} · ${reverse.needs.join(w.readiness.joiner)}`} action={null} />
          )}
        </ul>
      </section>
      <TaxWarnings warnings={w.warnings.items} />
    </div>
    </AdminTextScope>
  );
}
