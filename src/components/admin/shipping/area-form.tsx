"use client";

import { useState } from "react";

import { ActionForm, SubmitButton, type FormState } from "@/components/admin/action-form";
import { INFO_MAX, RADIUS_KM_MAX, RADIUS_KM_MIN } from "@/lib/shipping-limits";
import { fillWords } from "@/lib/admin-fill";
import { typedAmount } from "@/lib/shipping-method-form";

import { useAdminText } from "../admin-text";

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
  const w = useAdminText("shipping").local.form;
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
          {w.name}
          <input name="name" required maxLength={60} defaultValue={area?.name ?? ""} placeholder={w.namePlaceholder} className={control} disabled={!canWrite} />
        </label>
        {area ? (
          <input type="hidden" name="market" value={area.marketCode} />
        ) : (
          <label className="flex flex-col gap-1 text-sm">
            {w.country}
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
        <legend className="mb-1">{w.area}</legend>
        <label className="flex items-center gap-2">
          <input type="radio" name="kind" value="postal" checked={kind === "postal"} onChange={() => setKind("postal")} />
          {w.postal}
        </label>
        <label className="flex items-center gap-2">
          <input type="radio" name="kind" value="radius" checked={kind === "radius"} onChange={() => setKind("radius")} disabled={!radiusOk && kind !== "radius"} />
          {w.radius}
          {!radiusOk && <span className="text-muted">{w.noRadius}</span>}
        </label>
      </fieldset>
      {kind === "postal" ? (
        <label className="flex flex-col gap-1 text-sm">
          {w.patterns}
          <textarea name="patterns" required rows={3} defaultValue={area?.patterns.join(", ") ?? ""} placeholder="0150, 0151, 02*" className={`${control} py-2 font-mono`} disabled={!canWrite} />
          <span className="text-muted">{w.patternsNote}</span>
        </label>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="flex flex-col gap-1 text-sm">
            {w.from}
            <select name="location" required defaultValue={area?.locationId ?? ""} className={control} disabled={!canWrite}>
              <option value="" disabled>
                {w.choosePlace}
              </option>
              {placesHere.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                  {p.hasPosition ? "" : w.noPosition}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm">
            {w.radiusKm}
            <input name="radiusKm" inputMode="decimal" required defaultValue={area?.radiusKm ?? ""} placeholder={fillWords(w.radiusPlaceholder, { min: RADIUS_KM_MIN, max: RADIUS_KM_MAX })} className={control} disabled={!canWrite} />
          </label>
        </div>
      )}
      <div className="grid gap-4 sm:grid-cols-3">
        <label className="flex flex-col gap-1 text-sm">
          {fillWords(w.price, { currency })}
          <input name="amount" inputMode="decimal" defaultValue={money(area?.amountMinor)} placeholder={w.free} className={control} disabled={!canWrite} />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          {fillWords(w.minimum, { currency })}
          <input name="minBasket" inputMode="decimal" defaultValue={money(area?.minBasketMinor)} placeholder={w.none} className={control} disabled={!canWrite} />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          {fillWords(w.freeAbove, { currency })}
          <input name="freeOver" inputMode="decimal" defaultValue={money(area?.freeOverMinor)} placeholder={w.neverFree} className={control} disabled={!canWrite} />
        </label>
      </div>
      <label className="flex flex-col gap-1 text-sm">
        {w.info}
        <textarea name="info" rows={2} maxLength={INFO_MAX} defaultValue={area?.info ?? ""} placeholder={w.infoPlaceholder} className={`${control} py-2`} disabled={!canWrite} />
        <span className="text-muted">{w.infoNote}</span>
      </label>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="active" defaultChecked={area?.active ?? true} disabled={!canWrite} />
        {w.offered}
      </label>
      {canWrite && (
        <div>
          <SubmitButton variant={area ? "secondary" : "primary"}>{area ? w.save : w.add}</SubmitButton>
        </div>
      )}
    </ActionForm>
  );
}
