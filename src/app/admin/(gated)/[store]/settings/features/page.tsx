import type { Metadata } from "next";

import { ActionForm, SubmitButton } from "@/components/admin/action-form";
import { AfterSaleNote } from "@/components/admin/after-sale-gate";
import { FeaturesView } from "@/components/admin/features-view";
import { formatMoney } from "@/lib/money";
import { FEATURE_GROUPS, featureCount, featureRows, featuresIn } from "@/lib/store-features";
import { REMINDER_HOURS, storeTimeZones } from "@/server/bookings";
import { memberCan, requirePermission } from "@/server/permissions";
import { featureFacts } from "@/server/store-features";

import { saveBookingSettingsAction, switchFeatureAction } from "./actions";

export const metadata: Metadata = { title: "Features" };

const control = "min-h-11 rounded-md border border-border bg-background px-3 font-normal";

/**
 * The store's features (D178, docs/store-features.md): the online shop's master switch and the features in their groups. Every member who
 * may read the settings sees it; only owners switch. The time zone and the appointment reminder live here, under the switches they serve.
 */
export default async function FeaturesPage({ params }: PageProps<"/admin/[store]/settings/features">) {
  const current = await requirePermission((await params).store, "settings:read");
  const { store } = current;
  const owner = memberCan(current, "owner");
  const locale = store.markets[0]?.locale ?? "en";
  const facts = await featureFacts(store.id);
  const rows = featureRows(store, facts, (minor, currency) => formatMoney(minor, currency, locale));

  return (
    <div className="flex flex-col gap-6">
      {/* With the online shop off, what was sold stays reachable while it can still be withdrawn from or returned (D178 step 5). */}
      <AfterSaleNote store={store} />
      <FeaturesView
        base={`/admin/${store.slug}`}
        owner={owner}
        shop={rows.shop}
        groups={FEATURE_GROUPS.map((g) => ({ id: g.id, label: g.label, rows: featuresIn(g.id).map((f) => rows[f.id]) }))}
        count={featureCount(store)}
        onSwitch={switchFeatureAction.bind(null, store.slug)}
      />

      <section aria-labelledby="times-heading" className="rounded-lg border border-border bg-surface p-4">
        <h2 id="times-heading" className="mb-1 font-medium">
          Time zone and reminders
        </h2>
        <p className="mb-4 text-sm text-muted">
          Where the store&apos;s times are: appointments, stays and rentals, and subscription boxes&apos; cutoffs are shown in it.
        </p>
        <ActionForm action={saveBookingSettingsAction.bind(null, store.slug)} className="flex flex-col gap-4">
          <label className="flex flex-col gap-1 text-sm font-medium">
            Time zone
            <select name="timeZone" defaultValue={store.timeZone} disabled={!owner} className={control}>
              {storeTimeZones().map((zone) => (
                <option key={zone} value={zone}>
                  {zone.replace("_", " ")}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm font-medium">
            Appointment reminder email
            <select name="reminderHours" defaultValue={store.bookingReminderHours} disabled={!owner} className={control}>
              {REMINDER_HOURS.map((hours) => (
                <option key={hours} value={hours}>
                  {hours === 0 ? "Send none" : hours < 48 ? `${hours} hours before` : `${hours / 24} days before`}
                </option>
              ))}
            </select>
            <span className="font-normal text-muted">
              Shoppers get a reminder with the time, place and a calendar file. Those who book closer to the time than this get only their
              confirmation.
            </span>
          </label>
          {owner ? (
            <div>
              <SubmitButton>Save</SubmitButton>
            </div>
          ) : (
            <p className="text-sm text-muted">Only an owner can change these.</p>
          )}
        </ActionForm>
      </section>
    </div>
  );
}
