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
  only,
  w = setupEn.businessFields,
}: {
  /**
   * Only these of the three the law needs are asked (round 23, D688: the Company page's card of what is missing); the rest is sent as it
   * is, hidden, so the save keeps it. Left out, every field is shown.
   */
  only?: readonly ("legalName" | "postalAddress" | "country")[];
  name: string;
  details: StoreDetails;
  countries: Country[];
  fallbackEmail: string;
  /** The fields' words in the account's language (`adminText(lang, "setup").businessFields`). */
  w?: SetupMessages["businessFields"];
}) {
  const asks = (key: "legalName" | "postalAddress" | "country") => !only || only.includes(key);
  if (only) {
    return (
      <>
        <input type="hidden" name="name" value={name} />
        <input type="hidden" name="organisationNumber" value={details.organisationNumber ?? ""} />
        <input type="hidden" name="contactEmail" value={details.contactEmail ?? fallbackEmail} />
        {!asks("legalName") && <input type="hidden" name="legalName" value={details.legalName ?? ""} />}
        {!asks("postalAddress") && <input type="hidden" name="postalAddress" value={details.postalAddress ?? ""} />}
        {!asks("country") && <input type="hidden" name="country" value={details.country ?? ""} />}
        {asks("legalName") && <LegalName details={details} w={w} />}
        {asks("postalAddress") && <Address details={details} w={w} />}
        {asks("country") && <CountryField details={details} countries={countries} w={w} />}
      </>
    );
  }
  return (
    <>
      <div className={field}>
        <label htmlFor="store-name">{w.storeName}</label>
        <input id="store-name" name="name" required maxLength={80} aria-describedby="store-name-hint" defaultValue={name} className={control} />
        <p id="store-name-hint" className="font-normal text-muted">
          {w.storeNameHint}
        </p>
      </div>
      <LegalName details={details} w={w} />
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
      <Address details={details} w={w} />
      <CountryField details={details} countries={countries} w={w} />
    </>
  );
}

function LegalName({ details, w }: { details: StoreDetails; w: SetupMessages["businessFields"] }) {
  return (
    <label className={field}>
      {w.legalName}
      <input
        name="legalName"
        required
        autoComplete="organization"
        defaultValue={details.legalName ?? ""}
        placeholder={"Kari Nordmann AS"}
        className={control}
      />
    </label>
  );
}

function Address({ details, w }: { details: StoreDetails; w: SetupMessages["businessFields"] }) {
  return (
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
  );
}

function CountryField({ details, countries, w }: { details: StoreDetails; countries: Country[]; w: SetupMessages["businessFields"] }) {
  return (
    <label className={field}>
      {w.country}
      {/* Never chosen for the owner: the country decides the VAT on what Kaizena Flow bills, so it is asked for, not assumed. */}
      <select name="country" required defaultValue={details.country ?? ""} className={control}>
        {!details.country && <option value="">{w.chooseCountry}</option>}
        {countries.map((country) => (
          <option key={country.code} value={country.code}>
            {country.name}
          </option>
        ))}
      </select>
    </label>
  );
}
