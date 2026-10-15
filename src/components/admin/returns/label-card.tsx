import { ActionForm, SubmitButton } from "@/components/admin/action-form";
import { formatMoney } from "@/lib/money";
import { labelSentence, timeText } from "@/lib/return-admin";
import { labelProblemText } from "@/lib/return-label";
import { carrierInfo } from "@/lib/shipping-carriers";
import type { ReturnDetail } from "@/server/returns";
import type { LabelOptions } from "@/server/return-labels";

import type { StepAction } from "./step-forms";
import { Card, Fact } from "./ui";

const input = "min-h-10 w-full rounded-md border border-line bg-card px-3 text-sm";

/**
 * The return page's **Return shipping** card (wave 3, D239, `docs/wave-3-exchanges.md` 2.3): a label booked with the store's carrier (carrier, service, tracking, *Test
 * label*, the cost and who pays it, *Print label* through the admin's own route), or *Book a return label with {carrier}* when the carrier books returns for this order,
 * or why it cannot. A pasted label address (D153) stays in the instructions and keeps working; no label is also a choice: the customer sends it themselves.
 */
export function LabelCard({
  detail,
  options,
  printHref,
  book,
  canWrite,
  timeZone,
  locale = "en-GB",
}: {
  detail: ReturnDetail;
  /** What booking offers (`labelOptions()`); null when the return is gone. */
  options: LabelOptions | null;
  /** `/admin/{store}/returns/{id}/label` */
  printHref: string;
  book: StepAction | null;
  canWrite: boolean;
  timeZone: string;
  locale?: string;
}) {
  const label = detail.label;
  const booked = label.source === "carrier";
  const open = detail.status === "approved" || detail.status === "in_transit";
  if (!booked && !open) return null;
  const carrierName = label.carrierId ? (carrierInfo(label.carrierId)?.name ?? label.carrierId) : (options?.carrier?.name ?? null);
  const payer = options?.payer ?? detail.whoPaysReturn ?? null;
  const mayBook = canWrite && book !== null && open && options !== null && options.block === null && (!booked || label.test);
  const money = (minor: number) => formatMoney(minor, detail.currency, locale);

  return (
    <Card id="label" title="Return shipping" hint="Book a return label with the store's carrier, paste a label address in the instructions, or let the customer send the goods themselves.">
      <div className="flex flex-col gap-4 text-sm">
        <p>{labelSentence(label, payer, detail.currency, carrierName, locale)}</p>
        {booked && (
          <dl className="flex flex-col gap-2">
            <Fact label="Carrier">
              {carrierName}
              {label.service && <span className="text-muted"> · service {label.service}</span>}
            </Fact>
            {label.trackingNumber && (
              <Fact label="Tracking">
                {label.trackingUrl ? (
                  <a href={label.trackingUrl} target="_blank" rel="noreferrer" className="underline">
                    {label.trackingNumber}
                  </a>
                ) : (
                  label.trackingNumber
                )}
              </Fact>
            )}
            {label.test && (
              <Fact label="Test label">
                <span className="text-warning-text">Booked in the carrier&apos;s test environment: it cannot be used to send anything.</span>
              </Fact>
            )}
            <Fact label="Cost">
              {label.costMinor !== null ? money(label.costMinor) : "Not priced by the carrier"}
              {label.costCarrier && label.costCarrier.currency !== detail.currency && (
                <span className="text-muted"> ({formatMoney(label.costCarrier.amountMinor, label.costCarrier.currency, locale)} as the carrier priced it)</span>
              )}
            </Fact>
            {label.bookedAt && <Fact label="Booked">{timeText(label.bookedAt, timeZone)}</Fact>}
          </dl>
        )}
        {booked && (
          <p>
            <a href={printHref} target="_blank" rel="noreferrer" className="inline-flex min-h-10 items-center rounded-pill border border-edge bg-card px-4 hover:bg-sunken">
              Print label
            </a>
          </p>
        )}
        {mayBook && options && book && (
          <ActionForm action={book} className="flex flex-col gap-3" successMessage="Booked.">
            <label className="flex flex-col gap-1 font-medium">
              Parcel weight in grams <span className="font-normal text-muted">(estimated from the returned goods; change it if you know better)</span>
              <input name="weightGrams" type="number" inputMode="numeric" min={1} max={35000} defaultValue={options.weightGrams > 0 ? options.weightGrams : ""} className={`${input} sm:w-40`} />
            </label>
            <p className="text-muted">
              {payer === "shopper"
                ? "The customer pays return shipping for this order. Nothing is taken off when the label is booked: when you refund, you take off what the carrier charges (never more than the label cost) only if the parcel came back with this label. A test label is never taken off."
                : "The store pays return shipping for this order: nothing is taken off the refund."}
            </p>
            <div>
              <SubmitButton>{booked ? `Book again with ${carrierName ?? "the carrier"}` : `Book a return label with ${carrierName ?? "the carrier"}`}</SubmitButton>
            </div>
          </ActionForm>
        )}
        {open && !booked && options?.block && <p className="text-muted">A label cannot be booked: {labelProblemText(options.block)}</p>}
        {label.tries > 0 && !booked && <p className="text-warning-text">Booking did not go through ({label.tries === 1 ? "1 try" : `${label.tries} tries`}). Paste a label address in the instructions, or try again.</p>}
      </div>
    </Card>
  );
}
