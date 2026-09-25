import type { StoreLocation } from "@/server/company";
import type { Country } from "@/server/stores";

const field = "flex flex-col gap-1 text-sm font-medium";
const control = "min-h-10 rounded-md border border-border bg-background px-3 font-normal";
const optional = <span className="font-normal text-muted">(optional)</span>;

/** A place's address, phone and directions (D40), for the office, a shop or a pickup point. */
export function PlaceFields({
  place,
  countries,
  defaultCountry,
  what,
}: {
  place: StoreLocation | null;
  countries: Country[];
  defaultCountry: string;
  /** "the office", "the store", "the pickup point": for the hint under the notes. */
  what: string;
}) {
  return (
    <>
      <label className={field}>
        Street address
        <input name="street" required maxLength={200} autoComplete="address-line1" defaultValue={place?.street ?? ""} className={control} />
      </label>
      <div className="grid gap-4 sm:grid-cols-[10rem_1fr]">
        <label className={field}>
          Postcode
          <input name="postalCode" required maxLength={20} autoComplete="postal-code" defaultValue={place?.postalCode ?? ""} className={control} />
        </label>
        <label className={field}>
          Town or city
          <input name="city" required maxLength={80} autoComplete="address-level2" defaultValue={place?.city ?? ""} className={control} />
        </label>
      </div>
      <label className={field}>
        Country
        <select name="country" defaultValue={place?.country ?? defaultCountry} className={control}>
          {countries.map((country) => (
            <option key={country.code} value={country.code}>
              {country.name}
            </option>
          ))}
        </select>
      </label>
      <label className={field}>
        <span>Phone {optional}</span>
        <input name="phone" type="tel" maxLength={40} autoComplete="tel" defaultValue={place?.phone ?? ""} className={control} />
      </label>
      <div className={field}>
        <label htmlFor="place-notes">Directions {optional}</label>
        <textarea
          id="place-notes"
          name="notes"
          rows={2}
          maxLength={500}
          aria-describedby="place-notes-hint"
          defaultValue={place?.notes ?? ""}
          className={`${control} py-2`}
        />
        <p id="place-notes-hint" className="font-normal text-muted">
          How to find {what}, where to park, what to bring.
        </p>
      </div>
    </>
  );
}
