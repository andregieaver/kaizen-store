import { ReminderEditor } from "@/components/admin/reminder-editor";
import type { ReminderText } from "@/lib/cart-reminders";
import { platformDiscountSummary } from "@/lib/discounts";
import { formatMoney } from "@/lib/money";
import { planReminderPreview } from "@/server/plan-reminders";
import { listPlatformDiscounts } from "@/server/platform-discounts";

import { savePlanReminderAction, sendTestPlanReminderAction } from "./actions";

/** The same editor as the stores' cart reminders, in English, with a sample plan in the preview. */
export async function PlanReminderForm({
  step,
}: {
  step: { id: string | null; delayMinutes: number; active: boolean; discountCodeId: string | null; content: Record<string, ReminderText> };
}) {
  const [preview, discounts] = await Promise.all([planReminderPreview(), listPlatformDiscounts()]);
  const money = (minor: number, currency: string) => formatMoney(minor, currency, "nb-NO");
  return (
    <ReminderEditor
      initial={step}
      storeName={preview.storeName}
      languages={[{ locale: "en", label: "English", currency: preview.currency, footer: ["Kaizen · kaizenstore.cloud"], sample: preview.sample }]}
      discounts={discounts
        .filter((d) => d.active || d.id === step.discountCodeId)
        .map((d) => ({ id: d.id, code: d.code, gives: platformDiscountSummary(d, money) }))}
      save={savePlanReminderAction.bind(null, step.id)}
      sendTest={step.id ? sendTestPlanReminderAction.bind(null, step.id) : null}
      back="/admin/platform/plan-reminders"
      purpose="plan"
    />
  );
}
