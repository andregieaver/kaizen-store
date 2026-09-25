import type { Metadata } from "next";
import Link from "next/link";

import { ActionForm, SubmitButton } from "@/components/admin/action-form";
import { BusinessDetailsFields } from "@/components/admin/business-details-fields";
import { HoursEditor } from "@/components/admin/hours-editor";
import { PlaceFields } from "@/components/admin/place-fields";
import { weekSummary } from "@/lib/opening-hours";
import { requireMember } from "@/server/auth";
import { getCompany, KIND_LABELS, type StoreLocation } from "@/server/company";
import { listCountries } from "@/server/stores";

import { saveBusinessAction, saveOfficeAction } from "./actions";

export const metadata: Metadata = { title: "Company" };

const card = "rounded-lg border border-border bg-background p-5";

/**
 * Who the store is and where to find it (D40): the business that sells,
 * its office with opening hours, and any physical stores and pickup points.
 */
export default async function CompanyPage({ params }: PageProps<"/admin/[store]/settings/company">) {
  const member = await requireMember((await params).store);
  const { store, role } = member;
  const [company, countries] = await Promise.all([getCompany(store.id), listCountries()]);
  const base = `/admin/${store.slug}/settings/company`;
  const homeCountry = store.details.country ?? "NO";

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Company</h1>
        <p className="text-sm text-muted">Who you are and where to find you: the business that sells, your office and any stores or pickup points.</p>
      </div>

      <section aria-labelledby="business" className={card}>
        <h2 id="business" className="mb-1 font-medium">Business</h2>
        <p className="mb-4 text-sm text-muted">
          Shoppers see these in the footer, the terms of sale and every order confirmation. The law requires them.
        </p>
        {role === "owner" ? (
          <ActionForm action={saveBusinessAction.bind(null, store.slug)} className="flex flex-col gap-4">
            <BusinessDetailsFields name={store.name} details={store.details} countries={countries} fallbackEmail={member.account.email} />
            <div>
              <SubmitButton>Save business details</SubmitButton>
            </div>
          </ActionForm>
        ) : (
          <p className="text-sm">
            {store.details.legalName ?? store.name}
            {store.details.organisationNumber && ` · ${store.details.organisationNumber}`}
            <span className="block text-muted">Only an owner can change the business details.</span>
          </p>
        )}
      </section>

      <section aria-labelledby="office" className={card}>
        <h2 id="office" className="mb-1 font-medium">Office</h2>
        <p className="mb-4 text-sm text-muted">Where the business is run from, and when you can be reached.</p>
        <ActionForm action={saveOfficeAction.bind(null, store.slug)} className="flex flex-col gap-4">
          <PlaceFields place={company.office} countries={countries} defaultCountry={homeCountry} what="the office" />
          <div className="border-t border-border pt-4">
            <h3 className="mb-3 text-sm font-medium">Office hours</h3>
            <HoursEditor name="hours" initial={company.office?.hours ?? null} optional />
          </div>
          <div>
            <SubmitButton>Save office</SubmitButton>
          </div>
        </ActionForm>
      </section>

      <section aria-labelledby="places" className={card}>
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 id="places" className="font-medium">Stores and pickup points</h2>
            <p className="text-sm text-muted">Places where shoppers can visit you or collect their orders.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link href={`${base}/places/new?kind=shop`} className="min-h-10 rounded-md border border-border px-3 py-2 text-sm hover:bg-surface">
              Add a store
            </Link>
            <Link href={`${base}/places/new?kind=pickup`} className="min-h-10 rounded-md border border-border px-3 py-2 text-sm hover:bg-surface">
              Add a pickup point
            </Link>
          </div>
        </div>
        {company.places.length === 0 ? (
          <p className="rounded-md border border-dashed border-border p-6 text-center text-sm text-muted">
            No stores or pickup points yet. Add one if shoppers can visit you or collect orders.
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {company.places.map((place) => (
              <PlaceRow key={place.id} place={place} href={`${base}/places/${place.id}`} />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function PlaceRow({ place, href }: { place: StoreLocation; href: string }) {
  return (
    <li className="flex flex-wrap items-start justify-between gap-3 py-3 text-sm">
      <div className="min-w-0">
        <Link href={href} className="font-medium underline-offset-2 hover:underline">
          {place.name}
        </Link>{" "}
        <span className="rounded bg-surface px-1.5 py-0.5 text-xs">{KIND_LABELS[place.kind]}</span>
        <span className="block text-muted">
          {place.street}, {place.postalCode} {place.city}
        </span>
        <span className="block text-xs text-muted">{place.hours ? weekSummary(place.hours.week) : "No opening hours shown"}</span>
      </div>
      <Link href={href} className="min-h-10 rounded-md px-3 py-2 hover:bg-surface">
        Edit <span className="sr-only">{place.name}</span>
      </Link>
    </li>
  );
}
