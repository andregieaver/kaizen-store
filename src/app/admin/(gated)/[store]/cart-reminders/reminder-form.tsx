import { ReminderEditor } from "@/components/admin/reminder-editor";
import type { ReminderText } from "@/lib/cart-reminders";
import { describeDiscount } from "@/lib/discounts";
import { formatMoney } from "@/lib/money";
import { reminderLanguages } from "@/server/cart-reminders";
import { listDiscounts } from "@/server/discounts";
import type { Store } from "@/server/stores";

import { saveReminderStepAction, sendTestReminderAction } from "./actions";

/** The editor, with the store's languages, codes and a sample cart for the preview. */
export async function ReminderForm({
  store,
  step,
}: {
  store: Store;
  step: { id: string | null; delayMinutes: number; active: boolean; discountCodeId: string | null; content: Record<string, ReminderText> };
}) {
  const [languages, discounts] = await Promise.all([reminderLanguages(store.id), listDiscounts(store.id)]);
  const locale = store.markets[0]?.locale ?? "nb-NO";
  const currencyOf = (marketCode: string) => store.markets.find((m) => m.code === marketCode)?.currency ?? "NOK";
  const money = (minor: number, marketCode: string) => formatMoney(minor, currencyOf(marketCode), locale);
  return (
    <ReminderEditor
      initial={step}
      storeName={store.name}
      languages={languages}
      discounts={discounts
        .filter((d) => d.active || d.id === step.discountCodeId)
        .map((d) => ({ id: d.id, code: d.code, gives: describeDiscount(d, money) }))}
      save={saveReminderStepAction.bind(null, store.slug, step.id)}
      sendTest={step.id ? sendTestReminderAction.bind(null, store.slug, step.id) : null}
      back={`/admin/${store.slug}/cart-reminders`}
    />
  );
}
