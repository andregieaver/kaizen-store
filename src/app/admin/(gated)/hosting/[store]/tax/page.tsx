import type { Metadata } from "next";
import Link from "next/link";

import { ActionForm, SubmitButton } from "@/components/admin/action-form";
import { isoCountries } from "@/lib/iso-countries";
import { getHostTaxDetails } from "@/server/dac7";
import { requireHost } from "@/server/hosts";
import { PageHeader } from "@/components/admin/ui";
import { fillWords } from "@/lib/admin-fill";
import { adminLangOf } from "@/lib/admin-lang";
import { adminText } from "@/lib/admin-text";

import { hostSaveTaxDetailsAction } from "../actions";

export const metadata: Metadata = { title: "Tax details" };

const field = "flex flex-col gap-1 text-sm font-medium";
const control = "min-h-10 rounded-md border border-line bg-card px-3 font-normal";
const hint = "font-normal text-muted";

/**
 * A host's details for DAC7 (D71): the store must report who its hosts are
 * and what they earned to the tax authority each year, so hosts give them
 * here. Only the host and the store's staff see them.
 */
export default async function HostTaxPage({ params }: PageProps<"/admin/hosting/[store]/tax">) {
  const { store, host, account } = await requireHost((await params).store);
  const w = adminText(adminLangOf(account.adminLocale), "bookings").hostTax;
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
        <PageHeader
          title={w.title}
          description={fillWords(w.description, { store: store.name })}
        />
        </div>
      <ActionForm action={hostSaveTaxDetailsAction.bind(null, store.slug)} className="flex flex-col gap-4">
        <fieldset className="flex flex-col gap-2 text-sm">
          <legend className="mb-1 font-medium">{w.as}</legend>
          <label className="flex items-center gap-2">
            <input type="radio" name="kind" value="individual" defaultChecked={details?.kind !== "entity"} /> {w.person}
          </label>
          <label className="flex items-center gap-2">
            <input type="radio" name="kind" value="entity" defaultChecked={details?.kind === "entity"} /> {w.business}
          </label>
        </fieldset>
        <label className={field}>
          {w.legalName}
          <input name="legalName" required maxLength={200} defaultValue={details?.legalName ?? ""} className={control} />
        </label>
        <div className="flex flex-wrap gap-4">
          <label className={field}>
            <span>
              {w.birth} <span className={hint}>{w.birthHint}</span>
            </span>
            <input type="date" name="dateOfBirth" defaultValue={details?.dateOfBirth ?? ""} className={control} />
          </label>
          <label className={`${field} min-w-48 flex-1`}>
            <span>
              {w.businessNumber} <span className={hint}>{w.businessNumberHint}</span>
            </span>
            <input name="businessNumber" maxLength={40} defaultValue={details?.businessNumber ?? ""} className={control} />
          </label>
        </div>
        <label className={field}>
          {w.address} <span className={hint}>{w.addressHint}</span>
          <textarea name="address" required rows={3} maxLength={400} defaultValue={details?.address ?? ""} className={`${control} py-2`} />
        </label>
        <label className={field}>
          {w.country}
          {countrySelect("country", details?.country ?? home)}
        </label>
        <div className="flex flex-wrap gap-4">
          <label className={`${field} min-w-48 flex-1`}>
            <span>
              {w.tin} <span className={hint}>{w.tinHint}</span>
            </span>
            <input name="tin" required maxLength={40} autoComplete="off" defaultValue={details?.tin ?? ""} className={control} />
          </label>
          <label className={field}>
            {w.issuedBy}
            {countrySelect("tinCountry", details?.tinCountry ?? home)}
          </label>
        </div>
        <label className={field}>
          <span>
            {w.vat} <span className={hint}>{w.vatHint}</span>
          </span>
          <input name="vatNumber" maxLength={40} defaultValue={details?.vatNumber ?? ""} className={control} />
        </label>
        <label className={field}>
          <span>
            {w.iban} <span className={hint}>{w.ibanHint}</span>
          </span>
          <input name="iban" maxLength={50} autoComplete="off" defaultValue={details?.iban ?? ""} className={`${control} font-mono`} />
        </label>
        <div>
          <SubmitButton>{w.save}</SubmitButton>
        </div>
      </ActionForm>
    </div>
  );
}
