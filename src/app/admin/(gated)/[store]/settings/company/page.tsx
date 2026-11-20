import type { Metadata } from "next";
import Link from "next/link";

import { FoldRow } from "@/components/admin/fold-row";
import { ActionForm, SubmitButton } from "@/components/admin/action-form";
import { AdminTextScope } from "@/components/admin/admin-text";
import { AudienceFields } from "@/components/admin/audience-fields";
import { BusinessDetailsFields } from "@/components/admin/business-details-fields";
import { FeatureOffNote } from "@/components/admin/feature-off";
import { FoldOpenOnce } from "@/components/admin/fold-open-once";
import { HoursEditor } from "@/components/admin/hours-editor";
import { PlaceFields } from "@/components/admin/place-fields";
import { ADMIN_LANG_FACTS, adminLangOf } from "@/lib/admin-lang";
import { weekSummary } from "@/lib/opening-hours";
import { featureOn } from "@/lib/store-features";
import { memberCan, requirePermission } from "@/server/permissions";
import { getCompany, type StoreLocation } from "@/server/company";
import { listCountries } from "@/server/stores";
import { CARD_CLASS, PageHeader } from "@/components/admin/ui";
import { countWords, fillWords } from "@/lib/admin-fill";
import { submitClass } from "@/lib/submit-class";
import { ChevronDown } from "lucide-react";
import type { SettingsMessages } from "@/lib/admin-messages/settings.en";

import { saveAudienceAction, saveBusinessAction, saveOfficeAction } from "./actions";
import { cancelBusinessChangeAction, planBusinessChangeAction, tickBusinessStepAction } from "./business-actions";
import { BusinessChangeSection } from "@/components/admin/business-change-section";
import { PrivacyOfficerForm } from "@/components/admin/privacy-officer-form";
import { officerSummary } from "@/lib/privacy-officer";
import { accountOfficer, officerCandidates, officerForStore, storedChoice } from "@/server/privacy-officers";

import { setStoreOfficerAction } from "./officer-actions";
import { businessChecklist } from "@/lib/business-change";
import { zonedDate } from "@/lib/booking-slots";
import { areaTexts } from "@/lib/admin-area";
import { BUSINESS_WORDS } from "@/lib/admin-words/business";
import { PRIVACY_OFFICER_WORDS } from "@/lib/admin-words/privacy-officer";
import { SETTINGS_WORDS } from "@/lib/admin-words/settings";
import { SETTINGS_COMPANY_WORDS } from "@/lib/admin-words/settings-company";
import { SETTINGS_HOURS_WORDS } from "@/lib/admin-words/settings-hours";
import { SETUP_WORDS } from "@/lib/admin-words/setup";
import { businessChangesOf, businessChecklistFacts, businessSeriesNow } from "@/server/business-change";

export const metadata: Metadata = { title: "Company" };

const card = "rounded-lg border border-line bg-card p-5";

/**
 * Who the store is and where to find it (D40): the business that sells,
 * its office with opening hours, and any physical stores and pickup points.
 */
export default async function CompanyPage({ params }: PageProps<"/admin/[store]/settings/company">) {
  const member = await requirePermission((await params).store, "settings:read");
  const { store } = member;
  const [company, countries, changes, series] = await Promise.all([getCompany(store.id), listCountries(), businessChangesOf(store.id), businessSeriesNow(store.id)]);
  // Changing the business behind the store (B8, D473): the planned change with its checklist, and those that took effect.
  const planned = changes.find((c) => c.status === "planned") ?? null;
  const facts = planned ? await businessChecklistFacts(store, planned) : null;
  const owner = memberCan(member, "owner");
  const base = `/admin/${store.slug}/settings/company`;
  const homeCountry = store.details.country ?? "NO";
  const lang = adminLangOf(member.account.adminLocale);
  const all = SETTINGS_WORDS[lang];
  const w = all.company;

  // What the law needs shown (D40): the legal name, the registered address and the country; the rest is the owner's choice.
  const missing = (["legalName", "postalAddress", "country"] as const).filter((key) => !store.details[key]?.trim());
  const businessForm = owner ? (
    <ActionForm action={saveBusinessAction.bind(null, store.slug)} className="flex flex-col gap-4">
      <BusinessDetailsFields name={store.name} details={store.details} countries={countries} fallbackEmail={member.account.email} w={SETUP_WORDS[lang].businessFields} />
      <div>
        <SubmitButton>{w.saveBusiness}</SubmitButton>
      </div>
    </ActionForm>
  ) : (
    <p className="text-sm text-muted">{w.onlyOwnerBusiness}</p>
  );
  // Round 23 (D688): the card of what is missing asks only for it; the store name and contact are a row with Change.
  const missingForm = owner ? (
    <ActionForm action={saveBusinessAction.bind(null, store.slug)} className="flex flex-col gap-4">
      <BusinessDetailsFields only={missing} name={store.name} details={store.details} countries={countries} fallbackEmail={member.account.email} w={SETUP_WORDS[lang].businessFields} />
      <SubmitButton className={`${submitClass("primary")} min-h-12 w-full font-medium sm:w-auto sm:min-w-56`}>{w.saveBusiness}</SubmitButton>
    </ActionForm>
  ) : (
    <p className="text-sm text-muted">{w.onlyOwnerBusiness}</p>
  );
  const countryName = countries.find((c) => c.code === store.details.country)?.name ?? store.details.country;
  const businessSummary = [store.details.legalName, store.details.organisationNumber, store.details.postalAddress?.replace(/\s*\n\s*/g, ", "), countryName]
    .filter(Boolean)
    .join(" · ");
  // The data protection officer (D763): the store's own, or its account's.
  const pw = PRIVACY_OFFICER_WORDS[lang];
  const org = store.organisationId;
  const officer = org
    ? await Promise.all([officerForStore(store), storedChoice(org, store.id), officerCandidates(org, store.id), accountOfficer(org)]).then(([resolved, choice, people, ofAccount]) => ({ resolved, choice, people, ofAccount }))
    : null;
  const officerSub = officer?.resolved.officer
    ? officer.resolved.source === "account"
      ? fillWords(pw.sameAsAccountWho, { who: officerSummary(officer.resolved.officer) })
      : officerSummary(officer.resolved.officer)
    : pw.nobody;
  const office = company.office;
  const officeSummary = office
    ? [`${office.street}, ${office.postalCode} ${office.city}`, office.hours ? weekSummary(office.hours.week, all.hours) : w.noHours].join(" · ")
    : w.officeNone;

  return (
    <AdminTextScope texts={areaTexts(lang, { settingsCompany: SETTINGS_COMPANY_WORDS, settingsHours: SETTINGS_HOURS_WORDS })}>
    <div className="flex flex-col gap-6">
      <PageHeader
        title={w.title}
        meta={[
          <span key="lead">
            <span className="text-ink">{missing.length === 0 ? w.complete : countWords(missing.length, w.missing)}</span>
            {missing.length === 0 ? w.completeRest : w.missingRest}
          </span>,
        ]}
      />

      {missing.length > 0 && (
        <section aria-labelledby="business" className={`${CARD_CLASS} px-5 py-5 ring-[1.5px] ring-warning-line sm:px-6`}>
          <h2 id="business" className="mb-1 text-title text-ink">{w.fillIn}</h2>
          <p className="mb-4 text-sm text-muted">{fillWords(w.missingList, { list: missing.map((key) => w.fields[key]).join(", ") })}</p>
          {missingForm}
        </section>
      )}

      <section aria-labelledby="seen" className={`${CARD_CLASS} px-5 py-3 sm:px-6`}>
        <h2 id="seen" className="mt-2 mb-1 text-title text-ink">{w.seen}</h2>
        <ul className="divide-y divide-line">
          <FoldRow
            title={missing.length === 0 ? w.businessRow : w.contactRow}
            sub={[missing.length === 0 ? businessSummary : store.name, store.details.contactEmail || member.account.email].filter(Boolean).join(" · ")}
            action={owner ? w.change : null}
          >
            {businessForm}
          </FoldRow>
          {officer ? (
            <FoldRow title={pw.title} sub={officerSub} action={owner ? w.change : null}>
              <p className="mb-3 text-sm text-muted">{pw.storeLead}</p>
              <PrivacyOfficerForm
                words={pw}
                action={setStoreOfficerAction.bind(null, store.slug)}
                store
                choice={officer.choice}
                people={officer.people}
                current={officer.resolved.officer}
                accountOfficer={officer.ofAccount}
              />
            </FoldRow>
          ) : null}
          <FoldRow title={w.office} sub={officeSummary} action={office ? w.change : w.add}>
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
          </FoldRow>
          <li className="flex flex-col gap-2 py-3">
            <div className="flex min-h-11 flex-wrap items-center justify-between gap-3">
              <span className="flex flex-col">
                <span className="text-body text-ink">{w.places}</span>
                <span className="text-caption text-ink-2">{company.places.length === 0 ? w.placesNone : countWords(company.places.length, w.placesSome)}</span>
              </span>
              <span className="flex flex-wrap gap-2">
                <Link href={`${base}/places/new?kind=shop`} className="inline-flex min-h-10 items-center rounded-pill border border-edge px-3 text-sm hover:bg-sunken">
                  {w.addStore}
                </Link>
                <Link href={`${base}/places/new?kind=pickup`} className="inline-flex min-h-10 items-center rounded-pill border border-edge px-3 text-sm hover:bg-sunken">
                  {w.addPickup}
                </Link>
              </span>
            </div>
            {company.places.length > 0 && (
              <ul className="divide-y divide-line">
                {company.places.map((place) => (
                  <PlaceRow key={place.id} place={place} href={`${base}/places/${place.id}`} w={all} />
                ))}
              </ul>
            )}
          </li>
        </ul>
      </section>

      {/* Lisa's part (round 10, D633): selling to businesses and a change of business, one fold away; open while a change is planned. */}
      <FoldOpenOnce startOpen={planned !== null} className={`group ${CARD_CLASS}`}>
        <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 px-6 py-3 text-body text-ink [&::-webkit-details-marker]:hidden">
          {w.more}
          <ChevronDown aria-hidden className="size-4 transition-transform group-open:rotate-180" />
        </summary>
        <div className="flex flex-col gap-6 px-6 pb-6">
          <BusinessChangeSection
            words={BUSINESS_WORDS[lang]}
            planned={planned}
            applied={changes.filter((c) => c.status === "applied")}
            checklist={facts ? businessChecklist(facts) : null}
            legalPagesNamingOld={facts?.legalPagesNamingOld ?? 0}
            series={series}
            current={{ legalName: store.details.legalName || store.name, postalAddress: store.details.postalAddress || "" }}
            links={{
              bank: `/admin/account/work/s/${store.slug}/settings`,
              payments: `/admin/${store.slug}/settings/payments`,
              accounting: `/admin/${store.slug}/integrations`,
              legal: `/admin/${store.slug}/settings/legal`,
              plan: `/admin/${store.slug}/billing`,
            }}
            today={zonedDate(new Date().getTime(), store.timeZone)}
            locale={ADMIN_LANG_FACTS[lang].locale}
            actions={
              owner
                ? {
                    plan: planBusinessChangeAction.bind(null, store.slug),
                    cancel: cancelBusinessChangeAction.bind(null, store.slug),
                    tick: (step, done) => tickBusinessStepAction.bind(null, store.slug, step, done),
                  }
                : null
            }
          />
          <section aria-labelledby="customers" className={card}>
            <h2 id="customers" className="mb-1 text-title text-ink">{w.customers}</h2>
            <p className="mb-4 text-sm text-muted">{w.customersText}</p>
            {!featureOn(store, "business") ? (
              // Sell to businesses is off (D178): the store sells to consumers, whatever was chosen here before (kept for when it is on again).
              <FeatureOffNote storeSlug={store.slug} feature="business" owner={owner} what={w.sellingToBusinesses} />
            ) : owner ? (
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
        </div>
      </FoldOpenOnce>
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
