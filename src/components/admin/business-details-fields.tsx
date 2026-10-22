import { setupEn, type SetupMessages } from "@/lib/admin-messages/setup.en";
import type { Country, StoreDetails } from "@/server/stores";

const field = "flex flex-col gap-1 text-sm font-medium";
const control = "min-h-10 rounded-md border border-line bg-card px-3 font-normal";

/**
 * The business that sells (D40): the store's name, the legal business, its
 * contact email and registered address. Shoppers see them in the footer,
 * the terms of sale and every order confirmation. Used by setup and by the
 * Company page.
 */
export function BusinessDetailsFields({
  name,
  details,
  countries,
  fallbackEmail,
  w = setupEn.businessFields,
}: {
  name: string;
  details: StoreDetails;
  countries: Country[];
  fallbackEmail: string;
  /** The fields' words in the account's language (`adminText(lang, "setup").businessFields`). */
  w?: SetupMessages["businessFields"];
}) {
  return (
    <>
      <div className={field}>
        <label htmlFor="store-name">{w.storeName}</label>
        <input id="store-name" name="name" required maxLength={80} aria-describedby="store-name-hint" defaultValue={name} className={control} />
        <p id="store-name-hint" className="font-normal text-muted">
          {w.storeNameHint}
        </p>
      </div>
      <label className={field}>
        {w.legalName}
        <input
          name="legalName"
          required
          autoComplete="organization"
          defaultValue={details.legalName ?? ""}
          placeholder="Kari Nordmann AS"
          className={control}
        />
      </label>
      <label className={field}>
        <span>
          {w.organisationNumber} <span className="font-normal text-muted">{w.optional}</span>
        </span>
        <input name="organisationNumber" defaultValue={details.organisationNumber ?? ""} placeholder="123 456 789" className={control} />
      </label>
      <label className={field}>
        {w.contactEmail}
        <input
          type="email"
          name="contactEmail"
          required
          autoComplete="email"
          defaultValue={details.contactEmail ?? fallbackEmail}
          className={control}
        />
      </label>
      <label className={field}>
        {w.address}
        <textarea
          name="postalAddress"
          required
          rows={3}
          autoComplete="street-address"
          defaultValue={details.postalAddress ?? ""}
          placeholder={"Storgata 1\n0155 Oslo"}
          className={`${control} py-2`}
        />
      </label>
      <label className={field}>
        {w.country}
        <select name="country" defaultValue={details.country ?? "NO"} className={control}>
          {countries.map((country) => (
            <option key={country.code} value={country.code}>
              {country.name}
            </option>
          ))}
        </select>
      </label>
    </>
  );
}
