import { ActionForm, SubmitButton, type FormState } from "@/components/admin/action-form";
import { Card, Chip } from "@/components/admin/ui";
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
export const GEONAMES_ATTRIBUTION = "Postal-code positions © GeoNames, CC BY 4.0";

function areaSummary(area: LocalAreaItem): string {
  const where =
    area.kind === "radius"
      ? `Within ${String(area.radiusKm).replace(".", ",")} km of ${area.placeName ?? "a place"}${area.included === null ? "" : `, ${area.included} postal ${area.included === 1 ? "code" : "codes"}`}`
      : `${area.patterns.length} postal ${area.patterns.length === 1 ? "code or prefix" : "codes and prefixes"}`;
  const price = area.amountMinor === 0 ? "free" : formatMoney(area.amountMinor, area.currency, "en-GB");
  const minimum = area.minBasketMinor ? `, from a basket of ${formatMoney(area.minBasketMinor, area.currency, "en-GB")}` : "";
  const free = area.freeOverMinor ? `, free from ${formatMoney(area.freeOverMinor, area.currency, "en-GB")}` : "";
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
}) {
  const marketName = (code: string) => markets.find((m) => m.code === code)?.name ?? code;
  return (
    <div className="flex flex-col gap-6">
      {check && (
      <Card title="Check a postal code" description="Which areas cover a postal code, before anything is saved.">
        <ActionForm action={check} className="flex flex-wrap items-end gap-3">
          {markets.length > 1 ? (
            <label className="flex flex-col gap-1 text-sm">
              Country
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
            Postal code
            <input name="code" required maxLength={20} autoComplete="off" className="min-h-10 max-w-40 rounded-md border border-line bg-card px-3 text-sm" />
          </label>
          <SubmitButton variant="secondary">Check</SubmitButton>
        </ActionForm>
      </Card>
      )}

      {areas.length === 0 ? (
        <Card title="No areas yet">
          <p className="text-sm text-ink-2">Add the first area below. Until then, local delivery is not offered.</p>
        </Card>
      ) : (
        areas.map((area) => (
          <Card
            key={area.id}
            title={area.name}
            aside={area.active ? <Chip signal="positive">Offered</Chip> : <Chip>Off</Chip>}
            description={`${marketName(area.marketCode)} · ${areaSummary(area)}`}
          >
            <details>
              <summary className="cursor-pointer text-sm underline">Change this area</summary>
              <div className="mt-4">
                <AreaForm area={area} markets={markets} places={places} radiusCountries={radiusCountries} canWrite={canWrite} action={save(area.id)} />
              </div>
            </details>
            {canWrite && (
              <ActionForm action={remove(area.id)} className="mt-4 flex flex-wrap items-center gap-3 border-t border-line pt-4">
                <button type="submit" className="inline-flex h-8 items-center rounded-pill bg-danger-soft px-3 text-sm text-danger-text">
                  Delete {area.name}
                </button>
                <span className="text-sm text-muted">Orders already placed keep their delivery.</span>
              </ActionForm>
            )}
          </Card>
        ))
      )}

      {canWrite &&
        markets.length > 0 &&
        (areas.length >= AREAS_MAX ? (
          <p className="text-sm text-muted">The store has {AREAS_MAX} areas, the most it can have.</p>
        ) : (
          <Card title="Add an area">
            <AreaForm area={null} markets={markets} places={places} radiusCountries={radiusCountries} canWrite={canWrite} action={save(null)} />
          </Card>
        ))}

      {radiusCountries.length > 0 && (
        <p className="text-sm text-muted">
          Distances are measured between postal-code centres, so an address near the edge may be counted in or out, and in a city many codes share one
          centre. Use postal codes where you need a sharper line. {GEONAMES_ATTRIBUTION}.
        </p>
      )}
    </div>
  );
}
