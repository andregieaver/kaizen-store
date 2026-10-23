import type { Metadata } from "next";

import { requireFeature } from "@/components/admin/feature-off";
import { requirePermission } from "@/server/permissions";
import { getCartReminderSettings, newStepContent } from "@/server/cart-reminders";
import { PageHeader } from "@/components/admin/ui";
import { adminLangOf } from "@/lib/admin-lang";
import { adminText } from "@/lib/admin-text";

import { ReminderForm } from "../reminder-form";

export const metadata: Metadata = { title: "New cart reminder" };

export default async function NewReminderPage({ params }: PageProps<"/admin/[store]/cart-reminders/new">) {
  const gated = await requirePermission((await params).store, "marketing:read");
  // Part of the online shop (D178 step 5): hidden while it is off, the store being a website.
  const shopOff = requireFeature(gated, "shop");
  if (shopOff) return shopOff;
  const { store } = gated;
  const { steps } = await getCartReminderSettings(store.id);
  const last = steps.at(-1)?.delayMinutes ?? 0;
  const locales = store.localization.locales;
  const w = adminText(adminLangOf(gated.account.adminLocale), "bookings").cartReminders;
  return (
    <div className="flex flex-col gap-6">
      <PageHeader back={{ href: `/admin/${store.slug}/cart-reminders`, label: w.title }} title={w.newReminder} />
      <ReminderForm
        store={store}
        step={{
          id: null,
          delayMinutes: last > 0 ? last + 24 * 60 : 60,
          active: true,
          discountCodeId: null,
          content: newStepContent(locales, steps.length),
        }}
      />
    </div>
  );
}
