"use client";

import { useState } from "react";

import { ActionForm, SubmitButton, type FormState } from "@/components/admin/action-form";
import { INFO_MAX, RADIUS_KM_MAX, RADIUS_KM_MIN } from "@/lib/shipping-limits";
import { typedAmount } from "@/lib/shipping-method-form";

/**
 * One local delivery area's form (D237 2.3): its country (fixed once made), name, kind (postal codes, or a radius from a place in that country),
 * price, minimum basket, free-above value, the delivery information shoppers see, and the switch. The radius fields show only for a radius area,
 * and only where the country has postal-code reference data.
 */

export type AreaPlace = { id: string; name: string; country: string; hasPosition: boolean };

export type AreaDraft = {
  id: string;
  marketCode: string;
  currency: string;
  name: string;
  kind: "postal" | "radius";
  patterns: string[];
  locationId: string | null;
  radiusKm: number | null;
  amountMinor: number;
  minBasketMinor: number | null;
  freeOverMinor: number | null;
  info: string;
  active: boolean;
};

const control = "min-h-10 w-full rounded-md border border-line bg-card px-3 text-sm";

export function AreaForm({
  area,
  markets,
  places,
  radiusCountries,
  canWrite,
  action,
}: {
  area: AreaDraft | null;
  markets: { code: string; name: string; currency: string }[];
  places: AreaPlace[];
  /** Countries with postal-code centres loaded: only there can an area be a radius. */
  radiusCountries: string[];
  canWrite: boolean;
  action: (state: FormState, form: FormData) => Promise<FormState>;
}) {
  const [marketCode, setMarketCode] = useState(area?.marketCode ?? markets[0]?.code ?? "");
  const [kind, setKind] = useState<"postal" | "radius">(area?.kind ?? "postal");
  const currency = area?.currency ?? markets.find((m) => m.code === marketCode)?.currency ?? "";
  const radiusOk = radiusCountries.includes(marketCode);
  const placesHere = places.filter((p) => p.country === marketCode);
  const money = (minor: number | null | undefined) => (minor ? typedAmount(minor, currency) : "");
  return (
    <ActionForm action={action} className="flex flex-col gap-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-sm">
          Name, as shoppers see it
          <input name="name" required maxLength={60} defaultValue={area?.name ?? ""} placeholder="Delivery in town" className={control} disabled={!canWrite} />
        </label>
        {area ? (
          <input type="hidden" name="market" value={area.marketCode} />
        ) : (
          <label className="flex flex-col gap-1 text-sm">
            Country
            <select name="market" value={marketCode} onChange={(e) => setMarketCode(e.target.value)} className={control} disabled={!canWrite}>
              {markets.map((m) => (
                <option key={m.code} value={m.code}>
                  {m.name}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
      <fieldset className="flex flex-col gap-2 text-sm" disabled={!canWrite}>
        <legend className="mb-1">The area</legend>
        <label className="flex items-center gap-2">
          <input type="radio" name="kind" value="postal" checked={kind === "postal"} onChange={() => setKind("postal")} />
          Postal codes
        </label>
        <label className="flex items-center gap-2">
          <input type="radio" name="kind" value="radius" checked={kind === "radius"} onChange={() => setKind("radius")} disabled={!radiusOk && kind !== "radius"} />
          A distance from one of your places
          {!radiusOk && <span className="text-muted">(not for this country: no postal-code positions are loaded)</span>}
        </label>
      </fieldset>
      {kind === "postal" ? (
        <label className="flex flex-col gap-1 text-sm">
          Postal codes and prefixes
          <textarea name="patterns" required rows={3} defaultValue={area?.patterns.join(", ") ?? ""} placeholder="0150, 0151, 02*" className={`${control} py-2 font-mono`} disabled={!canWrite} />
          <span className="text-muted">Codes like 0150, or prefixes like 01*, separated by commas, spaces or lines. Areas may overlap: the cheapest is offered.</span>
        </label>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="flex flex-col gap-1 text-sm">
            Measured from
            <select name="location" required defaultValue={area?.locationId ?? ""} className={control} disabled={!canWrite}>
              <option value="" disabled>
                Choose a place
              </option>
              {placesHere.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                  {p.hasPosition ? "" : " (position from its postal code)"}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Radius (km)
            <input name="radiusKm" inputMode="decimal" required defaultValue={area?.radiusKm ?? ""} placeholder={`${RADIUS_KM_MIN} to ${RADIUS_KM_MAX}`} className={control} disabled={!canWrite} />
          </label>
        </div>
      )}
      <div className="grid gap-4 sm:grid-cols-3">
        <label className="flex flex-col gap-1 text-sm">
          Price ({currency}, including VAT)
          <input name="amount" inputMode="decimal" defaultValue={money(area?.amountMinor)} placeholder="Free" className={control} disabled={!canWrite} />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Minimum basket ({currency})
          <input name="minBasket" inputMode="decimal" defaultValue={money(area?.minBasketMinor)} placeholder="None" className={control} disabled={!canWrite} />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Free above ({currency})
          <input name="freeOver" inputMode="decimal" defaultValue={money(area?.freeOverMinor)} placeholder="Never free" className={control} disabled={!canWrite} />
        </label>
      </div>
      <label className="flex flex-col gap-1 text-sm">
        Delivery information
        <textarea name="info" rows={2} maxLength={INFO_MAX} defaultValue={area?.info ?? ""} placeholder="We deliver Tuesdays and Fridays between 16 and 20." className={`${control} py-2`} disabled={!canWrite} />
        <span className="text-muted">Shown at checkout and in the order confirmation, in the store&apos;s main language; translations are written on the Translate page.</span>
      </label>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="active" defaultChecked={area?.active ?? true} disabled={!canWrite} />
        Offered at checkout
      </label>
      {canWrite && (
        <div>
          <SubmitButton variant={area ? "secondary" : "primary"}>{area ? "Save area" : "Add area"}</SubmitButton>
        </div>
      )}
    </ActionForm>
  );
}
