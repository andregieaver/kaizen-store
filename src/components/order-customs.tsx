import { customsText, orderCustomsSentence } from "@/lib/customs-text";
import type { OrderCustoms } from "@/lib/duties";

/**
 * An order's customs and duties (D343) on its page: the duties and import VAT collected at checkout (DDP) as a row after the total, with what was
 * paid in all, and a sentence on who pays them. Nothing for an order whose goods crossed no customs border. Words: `customs-text.ts` (hand-written).
 */
/** An order as its page has it; an order read before D343 has neither field. */
type CustomsOrder = { totalMinor: number; dutiesMinor?: number; customs?: OrderCustoms | null };

export function OrderCustomsRows({ order, lang, money, paidLabel }: { order: CustomsOrder; lang: string; money: (minor: number) => string; paidLabel: string }) {
  const duties = order.dutiesMinor ?? 0;
  if (!(duties > 0)) return null;
  const words = customsText(lang);
  return (
    <>
      <div className="flex justify-between" data-customs-row>
        <dt>
          {words.dutiesLine} <span className="text-sm text-muted">({words.estimate})</span>
        </dt>
        <dd>{money(duties)}</dd>
      </div>
      <div className="flex justify-between font-semibold">
        <dt>{paidLabel}</dt>
        <dd>{money(order.totalMinor + duties)}</dd>
      </div>
    </>
  );
}

export function OrderCustomsNote({ order, lang, money }: { order: CustomsOrder; lang: string; money: (minor: number) => string }) {
  const sentence = orderCustomsSentence(order.customs ?? null, customsText(lang), money);
  return sentence ? (
    <p className="mt-2 text-sm text-muted" data-customs-note>
      {sentence}
    </p>
  ) : null;
}
