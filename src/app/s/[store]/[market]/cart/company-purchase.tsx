import type { BuyerFacts } from "@/server/company-locations";
import type { Messages } from "@/lib/i18n";
import { PO_NUMBER_MAX } from "@/lib/company-locations";

/**
 * A company member's purchase (D321 C.2): the location the order is for (asked when they buy for more than one) and the PO number (required when the
 * company says so), kept on the cart by a plain form so it works without JavaScript; `placeOrder()` checks both again. Says when an order over the
 * company's limit will wait for an approver.
 */
export function CompanyPurchase({
  facts,
  chosen,
  poNumber,
  limitText,
  action,
  m,
}: {
  facts: BuyerFacts;
  chosen: string | null;
  poNumber: string | null;
  /** The approval limit as shown, for an orderer at the chosen location; null when nothing will wait. */
  limitText: string | null;
  action: (form: FormData) => Promise<void>;
  m: Messages["companyAccount"];
}) {
  const control = "min-h-11 rounded-button border border-border bg-background px-3";
  const single = facts.places.length === 1 ? facts.places[0] : null;
  return (
    <section aria-labelledby="company-purchase-heading" className="flex flex-col gap-3 rounded-lg border border-border p-4">
      <h2 id="company-purchase-heading" className="font-heading text-lg">
        {m.purchaseTitle(facts.companyName)}
      </h2>
      <form action={action} className="flex flex-col gap-3">
        {single ? (
          <p className="text-sm">{m.forLocation(single.name)}</p>
        ) : facts.places.length > 1 ? (
          <label className="flex flex-col gap-1 text-sm font-medium">
            {m.location}
            <select name="location" defaultValue={chosen ?? ""} required className={control}>
              <option value="" disabled>
                {m.chooseLocation}
              </option>
              {facts.places.map((place) => (
                <option key={place.id} value={place.id}>
                  {place.name}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <label className="flex flex-col gap-1 text-sm font-medium">
          {facts.poRequired ? m.poNumberRequired : m.poNumber}
          <input name="po" defaultValue={poNumber ?? ""} maxLength={PO_NUMBER_MAX} required={facts.poRequired} className={control} />
        </label>
        {limitText && <p className="text-sm text-muted">{m.approvalNote(limitText)}</p>}
        <div>
          <button type="submit" className="min-h-11 rounded-button border border-border px-4">
            {m.purchaseSave}
          </button>
        </div>
      </form>
    </section>
  );
}
