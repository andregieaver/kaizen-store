import { settingsEn, type SettingsMessages } from "@/lib/admin-messages/settings.en";
import { fillWords } from "@/lib/admin-fill";
import type { StoreLocation } from "@/server/company";
import type { Country } from "@/server/stores";

const field = "flex flex-col gap-1 text-sm font-medium";
const control = "min-h-10 rounded-md border border-line bg-card px-3 font-normal";

/** A place's address, phone and directions (D40), for the office, a shop or a pickup point. */
export function PlaceFields({
  place,
  countries,
  defaultCountry,
  what,
  w = settingsEn,
}: {
  place: StoreLocation | null;
  countries: Country[];
  defaultCountry: string;
  /** "the office", "the store", "the pickup point": for the hint under the notes. */
  what: string;
  /** The words in the account's language (`adminText(lang, "settings")`). */
  w?: SettingsMessages;
}) {
  const t = w.company.place;
  const optional = <span className="font-normal text-muted">{w.common.optional}</span>;
  return (
    <>
      <label className={field}>
        {t.street}
        <input name="street" required maxLength={200} autoComplete="address-line1" defaultValue={place?.street ?? ""} className={control} />
      </label>
      <div className="grid gap-4 sm:grid-cols-[10rem_1fr]">
        <label className={field}>
          {t.postcode}
          <input name="postalCode" required maxLength={20} autoComplete="postal-code" defaultValue={place?.postalCode ?? ""} className={control} />
        </label>
        <label className={field}>
          {t.city}
          <input name="city" required maxLength={80} autoComplete="address-level2" defaultValue={place?.city ?? ""} className={control} />
        </label>
      </div>
      <label className={field}>
        {t.country}
        <select name="country" defaultValue={place?.country ?? defaultCountry} className={control}>
          {countries.map((country) => (
            <option key={country.code} value={country.code}>
              {country.name}
            </option>
          ))}
        </select>
      </label>
      <label className={field}>
        <span>{t.phone} {optional}</span>
        <input name="phone" type="tel" maxLength={40} autoComplete="tel" defaultValue={place?.phone ?? ""} className={control} />
      </label>
      <div className={field}>
        <label htmlFor="place-notes">{t.directions} {optional}</label>
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
          {fillWords(t.directionsHint, { what })}
        </p>
      </div>
    </>
  );
}
