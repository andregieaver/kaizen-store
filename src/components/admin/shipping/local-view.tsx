import { ActionForm, SubmitButton, type FormState } from "@/components/admin/action-form";
import { Card, Chip } from "@/components/admin/ui";
import { countWords, fillWords } from "@/lib/admin-fill";
import { shippingEn, type ShippingMessages } from "@/lib/admin-messages/shipping.en";
import { formatMoney } from "@/lib/money";
import { AREAS_MAX } from "@/lib/shipping-limits";

import { AreaForm, type AreaDraft, type AreaPlace } from "./area-form";

/**
 * Local delivery by the store's own drivers (D237, `docs/wave-3-shipping-methods.md` 2.3): areas by postal codes or by a radius from a place, each
 * with a price, a minimum basket and a free-above value; shoppers are offered the cheapest area that covers their postal code. The page states
 * the radius's limit (distances between postal-code centres, from GeoNames, CC BY 4.0) and how many codes a circle includes, and has *Check a postal
 * code*. Presentational: the page binds the actions.
 */

type Action = (state: FormState, form: FormData) => Promise<FormState>;

export type LocalAreaItem = AreaDraft & { placeName: string | null; included: number | null };

/** The attribution the reference data's licence asks for (CC BY 4.0), wherever radius areas are offered. */
export const GEONAMES_ATTRIBUTION = shippingEn.local.attribution;

function areaSummary(area: LocalAreaItem, w: ShippingMessages["local"], locale: string): string {
  const km = String(area.radiusKm).replace(".", ",");
  const where =
    area.kind === "radius"
      ? `${fillWords(w.within, { km, place: area.placeName ?? w.aPlace })}${area.included === null ? "" : countWords(area.included, w.included)}`
      : countWords(area.patterns.length, w.patterns);
  const price = area.amountMinor === 0 ? w.free : formatMoney(area.amountMinor, area.currency, locale);
  const minimum = area.minBasketMinor ? fillWords(w.fromBasket, { amount: formatMoney(area.minBasketMinor, area.currency, locale) }) : "";
  const free = area.freeOverMinor ? fillWords(w.freeFrom, { amount: formatMoney(area.freeOverMinor, area.currency, locale) }) : "";
  return `${where} · ${price}${minimum}${free}`;
}

export function LocalView({
  markets,
  areas,
  places,
  radiusCountries,
  canWrite,
  save,
  remove,
  check,
  words: w = shippingEn.local,
  locale = "en-GB",
}: {
  markets: { code: string; name: string; currency: string }[];
  areas: LocalAreaItem[];
  places: AreaPlace[];
  radiusCountries: string[];
  canWrite: boolean;
  save: (areaId: string | null) => Action;
  remove: (areaId: string) => Action;
  /** *Check a postal code*, for those who may change the settings; null hides it. */
  check: Action | null;
  /** The view's words and how amounts are written, in the admin's language (D312 A8); English unless given. The area form reads its own. */
  words?: ShippingMessages["local"];
  locale?: string;
}) {
  const marketName = (code: string) => markets.find((m) => m.code === code)?.name ?? code;
  return (
    <div className="flex flex-col gap-6">
      {check && (
      <Card title={w.checkTitle} description={w.checkDescription}>
        <ActionForm action={check} className="flex flex-wrap items-end gap-3">
          {markets.length > 1 ? (
            <label className="flex flex-col gap-1 text-sm">
              {w.country}
              <select name="market" className="min-h-10 rounded-md border border-line bg-card px-3 text-sm">
                {markets.map((m) => (
                  <option key={m.code} value={m.code}>
                    {m.name}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <input type="hidden" name="market" value={markets[0]?.code ?? ""} />
          )}
          <label className="flex flex-col gap-1 text-sm">
            {w.postalCode}
            <input name="code" required maxLength={20} autoComplete="off" className="min-h-10 max-w-40 rounded-md border border-line bg-card px-3 text-sm" />
          </label>
          <SubmitButton variant="secondary">{w.check}</SubmitButton>
        </ActionForm>
      </Card>
      )}

      {areas.length === 0 ? (
        <Card title={w.noAreas}>
          <p className="text-sm text-ink-2">{w.noAreasText}</p>
        </Card>
      ) : (
        areas.map((area) => (
          <Card
            key={area.id}
            title={area.name}
            aside={area.active ? <Chip signal="positive">{w.offered}</Chip> : <Chip>{w.off}</Chip>}
            description={`${marketName(area.marketCode)} · ${areaSummary(area, w, locale)}`}
          >
            <details>
              <summary className="cursor-pointer text-sm underline">{w.change}</summary>
              <div className="mt-4">
                <AreaForm area={area} markets={markets} places={places} radiusCountries={radiusCountries} canWrite={canWrite} action={save(area.id)} />
              </div>
            </details>
            {canWrite && (
              <ActionForm action={remove(area.id)} className="mt-4 flex flex-wrap items-center gap-3 border-t border-line pt-4">
                <button type="submit" className="inline-flex h-8 items-center rounded-pill bg-danger-soft px-3 text-sm text-danger-text">
                  {fillWords(w.delete, { name: area.name })}
                </button>
                <span className="text-sm text-muted">{w.deleteNote}</span>
              </ActionForm>
            )}
          </Card>
        ))
      )}

      {canWrite &&
        markets.length > 0 &&
        (areas.length >= AREAS_MAX ? (
          <p className="text-sm text-muted">{fillWords(w.full, { max: AREAS_MAX })}</p>
        ) : (
          <Card title={w.addTitle}>
            <AreaForm area={null} markets={markets} places={places} radiusCountries={radiusCountries} canWrite={canWrite} action={save(null)} />
          </Card>
        ))}

      {radiusCountries.length > 0 && (
        <p className="text-sm text-muted">
          {w.radiusNote} {w.attribution}.
        </p>
      )}
    </div>
  );
}
