import Link from "next/link";

import { ActionForm, SubmitButton, type FormState } from "@/components/admin/action-form";
import { Card, Chip } from "@/components/admin/ui";
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

export function PickupView({ places, companyHref, canWrite, save }: { places: PickupPlace[]; companyHref: string; canWrite: boolean; save: (place: PickupPlace) => Action }) {
  if (places.length === 0) {
    return (
      <Card title="No places yet">
        <p className="text-sm text-ink-2">
          Add a store or a pickup point under <Link href={companyHref} className="underline">Company</Link>, with its address and opening hours. It is then listed here.
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
            aside={option?.active && place.sellsThere ? <Chip signal="positive">Offered at checkout</Chip> : <Chip>Not offered</Chip>}
            description={`${place.kind === "shop" ? "Store" : "Pickup point"} · ${[place.street, `${place.postalCode} ${place.city}`.trim(), place.country].filter(Boolean).join(", ")}`}
          >
            {!place.sellsThere || !place.currency ? (
              <p className="text-sm text-muted">{place.country} is not a country you sell to, so customers cannot collect here.</p>
            ) : (
              <ActionForm action={save(place)} className="flex flex-col gap-4">
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" name="active" defaultChecked={option?.active ?? false} disabled={!canWrite} />
                  Customers can collect here
                </label>
                <div className="grid gap-4 sm:grid-cols-2">
                  <label className="flex flex-col gap-1 text-sm">
                    Price ({place.currency}, including VAT)
                    <input name="amount" inputMode="decimal" defaultValue={option && option.amountMinor > 0 ? typedAmount(option.amountMinor, place.currency) : ""} placeholder="Free" className={control} disabled={!canWrite} />
                  </label>
                  <label className="flex flex-col gap-1 text-sm">
                    Usually ready in (hours)
                    <input name="readyInHours" type="number" min={0} max={READY_HOURS_MAX} defaultValue={option?.readyInHours ?? 0} className={control} disabled={!canWrite} />
                    <span className="text-muted">0 promises nothing: customers are told you will email them when it is ready.</span>
                  </label>
                </div>
                <label className="flex flex-col gap-1 text-sm">
                  Pickup instructions
                  <textarea name="instructions" rows={3} maxLength={INSTRUCTIONS_MAX} defaultValue={option?.instructions ?? ""} placeholder="Ask at the counter and show your order number." className={`${control} py-2`} disabled={!canWrite} />
                  <span className="text-muted">
                    Sent in the Ready for pickup email and shown at checkout, in the store&apos;s main language.{" "}
                    {translations > 0 ? `${translations} ${translations === 1 ? "translation is" : "translations are"} kept;` : "Translations are"} written on the Translate page.
                  </span>
                </label>
                {canWrite && (
                  <div>
                    <SubmitButton>Save pickup</SubmitButton>
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
