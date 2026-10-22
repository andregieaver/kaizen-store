import type { Metadata } from "next";
import Link from "next/link";

import { ActionForm, SubmitButton } from "@/components/admin/action-form";
import { AdminTextScope } from "@/components/admin/admin-text";
import { AudienceFields } from "@/components/admin/audience-fields";
import { BusinessDetailsFields } from "@/components/admin/business-details-fields";
import { FeatureOffNote } from "@/components/admin/feature-off";
import { HoursEditor } from "@/components/admin/hours-editor";
import { PlaceFields } from "@/components/admin/place-fields";
import { adminLangOf } from "@/lib/admin-lang";
import { adminText, adminTexts } from "@/lib/admin-text";
import { weekSummary } from "@/lib/opening-hours";
import { featureOn } from "@/lib/store-features";
import { memberCan, requirePermission } from "@/server/permissions";
import { getCompany, type StoreLocation } from "@/server/company";
import { listCountries } from "@/server/stores";
import { PageHeader } from "@/components/admin/ui";
import type { SettingsMessages } from "@/lib/admin-messages/settings.en";

import { saveAudienceAction, saveBusinessAction, saveOfficeAction } from "./actions";

export const metadata: Metadata = { title: "Company" };

const card = "rounded-lg border border-line bg-card p-5";

/**
 * Who the store is and where to find it (D40): the business that sells,
 * its office with opening hours, and any physical stores and pickup points.
 */
export default async function CompanyPage({ params }: PageProps<"/admin/[store]/settings/company">) {
  const member = await requirePermission((await params).store, "settings:read");
  const { store } = member;
  const [company, countries] = await Promise.all([getCompany(store.id), listCountries()]);
  const base = `/admin/${store.slug}/settings/company`;
  const homeCountry = store.details.country ?? "NO";
  const lang = adminLangOf(member.account.adminLocale);
  const all = adminText(lang, "settings");
  const w = all.company;

  return (
    <AdminTextScope texts={adminTexts(lang, ["settings"])}>
    <div className="flex flex-col gap-6">
      <PageHeader title={w.title} description={<>{w.description}</>} />

      <section aria-labelledby="business" className={card}>
        <h2 id="business" className="mb-1 text-title text-ink">{w.business}</h2>
        <p className="mb-4 text-sm text-muted">{w.businessText}</p>
        {memberCan(member, "owner") ? (
          <ActionForm action={saveBusinessAction.bind(null, store.slug)} className="flex flex-col gap-4">
            <BusinessDetailsFields name={store.name} details={store.details} countries={countries} fallbackEmail={member.account.email} w={adminText(lang, "setup").businessFields} />
            <div>
              <SubmitButton>{w.saveBusiness}</SubmitButton>
            </div>
          </ActionForm>
        ) : (
          <p className="text-sm">
            {store.details.legalName ?? store.name}
            {store.details.organisationNumber && ` · ${store.details.organisationNumber}`}
            <span className="block text-muted">{w.onlyOwnerBusiness}</span>
          </p>
        )}
      </section>

      <section aria-labelledby="customers" className={card}>
        <h2 id="customers" className="mb-1 text-title text-ink">{w.customers}</h2>
        <p className="mb-4 text-sm text-muted">{w.customersText}</p>
        {!featureOn(store, "business") ? (
          // Sell to businesses is off (D178): the store sells to consumers, whatever was chosen here before (kept for when it is on again).
          <FeatureOffNote storeSlug={store.slug} feature="business" owner={memberCan(member, "owner")} what={w.sellingToBusinesses} />
        ) : memberCan(member, "owner") ? (
          <ActionForm action={saveAudienceAction.bind(null, store.slug)} className="flex flex-col gap-4">
            <AudienceFields audience={store.chosenAudience} businessPopup={store.businessPopup} />
            <div>
              <SubmitButton>{w.saveCustomers}</SubmitButton>
            </div>
          </ActionForm>
        ) : (
          <p className="text-sm">
            {w.audience.labels[store.audience]}
            <span className="block text-muted">{w.onlyOwnerAudience}</span>
          </p>
        )}
      </section>

      <section aria-labelledby="office" className={card}>
        <h2 id="office" className="mb-1 text-title text-ink">{w.office}</h2>
        <p className="mb-4 text-sm text-muted">{w.officeText}</p>
        <ActionForm action={saveOfficeAction.bind(null, store.slug)} className="flex flex-col gap-4">
          <PlaceFields place={company.office} countries={countries} defaultCountry={homeCountry} what={w.theOffice} w={all} />
          <div className="border-t border-line pt-4">
            <h3 className="mb-3 text-body-strong text-ink">{w.officeHours}</h3>
            <HoursEditor name="hours" initial={company.office?.hours ?? null} optional />
          </div>
          <div>
            <SubmitButton>{w.saveOffice}</SubmitButton>
          </div>
        </ActionForm>
      </section>

      <section aria-labelledby="places" className={card}>
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 id="places" className="text-title text-ink">{w.places}</h2>
            <p className="text-sm text-muted">{w.placesText}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link href={`${base}/places/new?kind=shop`} className="min-h-10 rounded-pill border border-edge px-3 py-2 text-sm hover:bg-sunken">
              {w.addStore}
            </Link>
            <Link href={`${base}/places/new?kind=pickup`} className="min-h-10 rounded-pill border border-edge px-3 py-2 text-sm hover:bg-sunken">
              {w.addPickup}
            </Link>
          </div>
        </div>
        {company.places.length === 0 ? (
          <p className="rounded-md border border-dashed border-line p-6 text-center text-sm text-muted">
            {w.noPlaces}
          </p>
        ) : (
          <ul className="divide-y divide-line">
            {company.places.map((place) => (
              <PlaceRow key={place.id} place={place} href={`${base}/places/${place.id}`} w={all} />
            ))}
          </ul>
        )}
      </section>
    </div>
    </AdminTextScope>
  );
}

function PlaceRow({ place, href, w }: { place: StoreLocation; href: string; w: SettingsMessages }) {
  return (
    <li className="flex flex-wrap items-start justify-between gap-3 py-3 text-sm">
      <div className="min-w-0">
        <Link href={href} className="font-medium underline-offset-2 hover:underline">
          {place.name}
        </Link>{" "}
        <span className="rounded bg-sunken px-1.5 py-0.5 text-xs">{w.company.kinds[place.kind]}</span>
        <span className="block text-muted">
          {place.street}, {place.postalCode} {place.city}
        </span>
        <span className="block text-xs text-muted">{place.hours ? weekSummary(place.hours.week, w.hours) : w.company.noHours}</span>
      </div>
      <Link href={href} className="min-h-10 rounded-pill px-3 py-2 hover:bg-sunken">
        {w.company.edit} <span className="sr-only">{place.name}</span>
      </Link>
    </li>
  );
}
