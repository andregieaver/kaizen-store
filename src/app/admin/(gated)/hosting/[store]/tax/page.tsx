import type { Metadata } from "next";
import Link from "next/link";

import { ActionForm, SubmitButton } from "@/components/admin/action-form";
import { isoCountries } from "@/lib/iso-countries";
import { getHostTaxDetails } from "@/server/dac7";
import { requireHost } from "@/server/hosts";

import { hostSaveTaxDetailsAction } from "../actions";

export const metadata: Metadata = { title: "Tax details" };

const field = "flex flex-col gap-1 text-sm font-medium";
const control = "min-h-10 rounded-md border border-border bg-background px-3 font-normal";
const hint = "font-normal text-muted";

/**
 * A host's details for DAC7 (D71): the store must report who its hosts are
 * and what they earned to the tax authority each year, so hosts give them
 * here. Only the host and the store's staff see them.
 */
export default async function HostTaxPage({ params }: PageProps<"/admin/hosting/[store]/tax">) {
  const { store, host } = await requireHost((await params).store);
  const details = await getHostTaxDetails(store.id, host.id);
  const countries = isoCountries();
  const home = store.details.country ?? "NO";
  const countrySelect = (name: string, value: string) => (
    <select name={name} defaultValue={value} required className={control}>
      {countries.map((c) => (
        <option key={c.code} value={c.code}>
          {c.name}
        </option>
      ))}
    </select>
  );

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6">
      <div>
        <Link href={`/admin/hosting/${store.slug}`} className="text-sm underline">
          {host.name}
        </Link>
        <h1 className="text-2xl font-semibold">Tax details</h1>
        <p className="text-sm text-muted">
          EU rules (DAC7) make {store.name} report to the tax authority, once a year, who its hosts are and what they were
          paid. Only you and the store see these details.
        </p>
      </div>
      <ActionForm action={hostSaveTaxDetailsAction.bind(null, store.slug)} className="flex flex-col gap-4">
        <fieldset className="flex flex-col gap-2 text-sm">
          <legend className="mb-1 font-medium">You rent out as</legend>
          <label className="flex items-center gap-2">
            <input type="radio" name="kind" value="individual" defaultChecked={details?.kind !== "entity"} /> A private person
          </label>
          <label className="flex items-center gap-2">
            <input type="radio" name="kind" value="entity" defaultChecked={details?.kind === "entity"} /> A business
          </label>
        </fieldset>
        <label className={field}>
          Full name, or the business&apos;s legal name
          <input name="legalName" required maxLength={200} defaultValue={details?.legalName ?? ""} className={control} />
        </label>
        <div className="flex flex-wrap gap-4">
          <label className={field}>
            <span>
              Date of birth <span className={hint}>(people)</span>
            </span>
            <input type="date" name="dateOfBirth" defaultValue={details?.dateOfBirth ?? ""} className={control} />
          </label>
          <label className={`${field} min-w-48 flex-1`}>
            <span>
              Business registration number <span className={hint}>(businesses)</span>
            </span>
            <input name="businessNumber" maxLength={40} defaultValue={details?.businessNumber ?? ""} className={control} />
          </label>
        </div>
        <label className={field}>
          Address <span className={hint}>where you live, or the business&apos;s registered address</span>
          <textarea name="address" required rows={3} maxLength={400} defaultValue={details?.address ?? ""} className={`${control} py-2`} />
        </label>
        <label className={field}>
          Country
          {countrySelect("country", details?.country ?? home)}
        </label>
        <div className="flex flex-wrap gap-4">
          <label className={`${field} min-w-48 flex-1`}>
            <span>
              Tax identification number <span className={hint}>(in Norway, your national identity or organisation number)</span>
            </span>
            <input name="tin" required maxLength={40} autoComplete="off" defaultValue={details?.tin ?? ""} className={control} />
          </label>
          <label className={field}>
            Issued by
            {countrySelect("tinCountry", details?.tinCountry ?? home)}
          </label>
        </div>
        <label className={field}>
          <span>
            VAT number <span className={hint}>(if you have one)</span>
          </span>
          <input name="vatNumber" maxLength={40} defaultValue={details?.vatNumber ?? ""} className={control} />
        </label>
        <label className={field}>
          <span>
            Bank account (IBAN) you are paid to <span className={hint}>(as in your Stripe account)</span>
          </span>
          <input name="iban" maxLength={50} autoComplete="off" defaultValue={details?.iban ?? ""} className={`${control} font-mono`} />
        </label>
        <div>
          <SubmitButton>Save</SubmitButton>
        </div>
      </ActionForm>
    </div>
  );
}
