import Link from "next/link";

import { ActionForm, SubmitButton, type FormState } from "@/components/admin/action-form";
import { Card, Chip } from "@/components/admin/ui";
import { countWords, fillWords } from "@/lib/admin-fill";
import { shippingEn, type ShippingMessages } from "@/lib/admin-messages/shipping.en";
import { INSTRUCTIONS_MAX, READY_HOURS_MAX } from "@/lib/shipping-limits";
import { typedAmount } from "@/lib/shipping-method-form";

/**
 * Pickup at the store's own places (D237, `docs/wave-3-shipping-methods.md` 2.2): every store and pickup point with a switch *Customers can collect
 * here*, a price (empty or 0 is free) in the currency of the country it is in, the usual time until an order is ready, and instructions that go into
 * the *Ready for pickup* email. A place in a country the store does not sell to cannot be switched on. Presentational.
 */

type Action = (state: FormState, form: FormData) => Promise<FormState>;

export type PickupPlace = {
  locationId: string;
  name: string;
  kind: "shop" | "pickup";
  street: string;
  postalCode: string;
  city: string;
  country: string;
  sellsThere: boolean;
  currency: string | null;
  option: { active: boolean; amountMinor: number; readyInHours: number; instructions: string; instructionsT: Record<string, string> } | null;
};

const control = "min-h-10 w-full rounded-md border border-line bg-card px-3 text-sm";

export function PickupView({
  places,
  companyHref,
  canWrite,
  save,
  words: w = shippingEn.pickup,
}: {
  places: PickupPlace[];
  companyHref: string;
  canWrite: boolean;
  save: (place: PickupPlace) => Action;
  /** The view's words in the admin's language (D312 A8); English unless given. */
  words?: ShippingMessages["pickup"];
}) {
  if (places.length === 0) {
    return (
      <Card title={w.noPlaces}>
        <p className="text-sm text-ink-2">
          {w.noPlacesBefore}
          <Link href={companyHref} className="underline">
            {w.companyLink}
          </Link>
          {w.noPlacesAfter}
        </p>
      </Card>
    );
  }
  return (
    <div className="flex flex-col gap-6">
      {places.map((place) => {
        const option = place.option;
        const translations = Object.keys(option?.instructionsT ?? {}).length;
        return (
          <Card
            key={place.locationId}
            title={place.name}
            aside={option?.active && place.sellsThere ? <Chip signal="positive">{w.offered}</Chip> : <Chip>{w.notOffered}</Chip>}
            description={`${place.kind === "shop" ? w.store : w.pickupPoint} · ${[place.street, `${place.postalCode} ${place.city}`.trim(), place.country].filter(Boolean).join(", ")}`}
          >
            {!place.sellsThere || !place.currency ? (
              <p className="text-sm text-muted">{fillWords(w.notSold, { country: place.country })}</p>
            ) : (
              <ActionForm action={save(place)} className="flex flex-col gap-4">
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" name="active" defaultChecked={option?.active ?? false} disabled={!canWrite} />
                  {w.canCollect}
                </label>
                <div className="grid gap-4 sm:grid-cols-2">
                  <label className="flex flex-col gap-1 text-sm">
                    {fillWords(w.price, { currency: place.currency })}
                    <input name="amount" inputMode="decimal" defaultValue={option && option.amountMinor > 0 ? typedAmount(option.amountMinor, place.currency) : ""} placeholder={w.free} className={control} disabled={!canWrite} />
                  </label>
                  <label className="flex flex-col gap-1 text-sm">
                    {w.ready}
                    <input name="readyInHours" type="number" min={0} max={READY_HOURS_MAX} defaultValue={option?.readyInHours ?? 0} className={control} disabled={!canWrite} />
                    <span className="text-muted">{w.readyNote}</span>
                  </label>
                </div>
                <label className="flex flex-col gap-1 text-sm">
                  {w.instructions}
                  <textarea name="instructions" rows={3} maxLength={INSTRUCTIONS_MAX} defaultValue={option?.instructions ?? ""} placeholder={w.instructionsPlaceholder} className={`${control} py-2`} disabled={!canWrite} />
                  <span className="text-muted">
                    {w.instructionsNote} {translations > 0 ? countWords(translations, w.translations) : w.noTranslations}
                  </span>
                </label>
                {canWrite && (
                  <div>
                    <SubmitButton>{w.save}</SubmitButton>
                  </div>
                )}
              </ActionForm>
            )}
          </Card>
        );
      })}
    </div>
  );
}
