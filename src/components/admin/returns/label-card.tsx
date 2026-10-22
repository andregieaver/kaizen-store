import { ActionForm, SubmitButton } from "@/components/admin/action-form";
import { countWords, fillWords } from "@/lib/admin-fill";
import { returnsEn, type ReturnsMessages } from "@/lib/admin-messages/returns.en";
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
  words: w = returnsEn,
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
  words?: ReturnsMessages;
}) {
  const c = w.labelCard;
  const label = detail.label;
  const booked = label.source === "carrier";
  const open = detail.status === "approved" || detail.status === "in_transit";
  if (!booked && !open) return null;
  const carrierName = label.carrierId ? (carrierInfo(label.carrierId)?.name ?? label.carrierId) : (options?.carrier?.name ?? null);
  const payer = options?.payer ?? detail.whoPaysReturn ?? null;
  const mayBook = canWrite && book !== null && open && options !== null && options.block === null && (!booked || label.test);
  const money = (minor: number) => formatMoney(minor, detail.currency, locale);

  return (
    <Card id="label" title={c.title} hint={c.hint}>
      <div className="flex flex-col gap-4 text-sm">
        <p>{labelSentence(label, payer, detail.currency, carrierName, locale, w)}</p>
        {booked && (
          <dl className="flex flex-col gap-2">
            <Fact label={c.carrier}>
              {carrierName}
              {label.service && <span className="text-muted">{fillWords(c.service, { service: label.service })}</span>}
            </Fact>
            {label.trackingNumber && (
              <Fact label={c.tracking}>
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
              <Fact label={c.testLabel}>
                <span className="text-warning-text">{c.testText}</span>
              </Fact>
            )}
            <Fact label={c.cost}>
              {label.costMinor !== null ? money(label.costMinor) : c.notPriced}
              {label.costCarrier && label.costCarrier.currency !== detail.currency && (
                <span className="text-muted">{fillWords(c.carrierPriced, { amount: formatMoney(label.costCarrier.amountMinor, label.costCarrier.currency, locale) })}</span>
              )}
            </Fact>
            {label.bookedAt && <Fact label={c.booked}>{timeText(label.bookedAt, timeZone, locale)}</Fact>}
          </dl>
        )}
        {booked && (
          <p>
            <a href={printHref} target="_blank" rel="noreferrer" className="inline-flex min-h-10 items-center rounded-pill border border-edge bg-card px-4 hover:bg-sunken">
              {c.print}
            </a>
          </p>
        )}
        {mayBook && options && book && (
          <ActionForm action={book} className="flex flex-col gap-3" successMessage={c.bookedDone}>
            <label className="flex flex-col gap-1 font-medium">
              {c.weight} <span className="font-normal text-muted">{c.weightHint}</span>
              <input name="weightGrams" type="number" inputMode="numeric" min={1} max={35000} defaultValue={options.weightGrams > 0 ? options.weightGrams : ""} className={`${input} sm:w-40`} />
            </label>
            <p className="text-muted">
              {payer === "shopper" ? c.shopperPays : c.storePays}
            </p>
            <div>
              <SubmitButton>{fillWords(booked ? c.bookAgain : c.book, { carrier: carrierName ?? c.theCarrier })}</SubmitButton>
            </div>
          </ActionForm>
        )}
        {open && !booked && options?.block && <p className="text-muted">{fillWords(c.cannot, { reason: labelProblemText(options.block) })}</p>}
        {label.tries > 0 && !booked && <p className="text-warning-text">{countWords(label.tries, c.tries)}</p>}
      </div>
    </Card>
  );
}
