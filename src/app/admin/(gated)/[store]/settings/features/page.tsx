import type { Metadata } from "next";

import { ActionForm, SubmitButton } from "@/components/admin/action-form";
import { AdminTextScope } from "@/components/admin/admin-text";
import { AfterSaleNote } from "@/components/admin/after-sale-gate";
import { FeaturesView } from "@/components/admin/features-view";
import { countWords } from "@/lib/admin-fill";
import { ADMIN_LANG_FACTS, adminLangOf } from "@/lib/admin-lang";
import { adminText, adminTexts } from "@/lib/admin-text";
import { formatMoney } from "@/lib/money";
import { FEATURE_GROUPS, featureCount, featuresIn } from "@/lib/store-features";
import { featureRows } from "@/lib/feature-words";
import { REMINDER_HOURS, storeTimeZones } from "@/server/bookings";
import { memberCan, requirePermission } from "@/server/permissions";
import { featureFacts } from "@/server/store-features";

import { saveBookingSettingsAction, switchFeatureAction } from "./actions";

export const metadata: Metadata = { title: "Features" };

const control = "min-h-11 rounded-md border border-line bg-card px-3 font-normal";

/**
 * The store's features (D178, docs/store-features.md): the online shop's master switch and the features in their groups. Every member who
 * may read the settings sees it; only owners switch. The time zone and the appointment reminder live here, under the switches they serve.
 */
export default async function FeaturesPage({ params }: PageProps<"/admin/[store]/settings/features">) {
  const current = await requirePermission((await params).store, "settings:read");
  const { store } = current;
  const owner = memberCan(current, "owner");
  const lang = adminLangOf(current.account.adminLocale);
  const all = adminText(lang, "settings");
  const words = { s: all.features, c: adminText(lang, "common").features };
  const w = all.features.times;
  const locale = ADMIN_LANG_FACTS[lang].locale;
  const facts = await featureFacts(store.id);
  const rows = featureRows(store, facts, (minor, currency) => formatMoney(minor, currency, locale), words);

  return (
    <AdminTextScope texts={adminTexts(lang, ["settings"])}>
    <div className="flex flex-col gap-6">
      {/* With the online shop off, what was sold stays reachable while it can still be withdrawn from or returned (D178 step 5). */}
      <AfterSaleNote store={store} />
      <FeaturesView
        base={`/admin/${store.slug}`}
        owner={owner}
        shop={rows.shop}
        groups={FEATURE_GROUPS.map((g) => ({ id: g.id, label: all.features.groups[g.id], rows: featuresIn(g.id).map((f) => rows[f.id]) }))}
        count={featureCount(store)}
        onSwitch={switchFeatureAction.bind(null, store.slug)}
      />

      <section aria-labelledby="times-heading" className="rounded-panel bg-sunken p-4">
        <h2 id="times-heading" className="mb-1 text-title text-ink">
          {w.title}
        </h2>
        <p className="mb-4 text-sm text-muted">{w.text}</p>
        <ActionForm action={saveBookingSettingsAction.bind(null, store.slug)} className="flex flex-col gap-4">
          <label className="flex flex-col gap-1 text-sm font-medium">
            {w.timeZone}
            <select name="timeZone" defaultValue={store.timeZone} disabled={!owner} className={control}>
              {storeTimeZones().map((zone) => (
                <option key={zone} value={zone}>
                  {zone.replace("_", " ")}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm font-medium">
            {w.reminder}
            <select name="reminderHours" defaultValue={store.bookingReminderHours} disabled={!owner} className={control}>
              {REMINDER_HOURS.map((hours) => (
                <option key={hours} value={hours}>
                  {hours === 0 ? w.sendNone : hours < 48 ? countWords(hours, { one: w.hoursBefore, many: w.hoursBefore }) : countWords(hours / 24, { one: w.daysBefore, many: w.daysBefore })}
                </option>
              ))}
            </select>
            <span className="font-normal text-muted">{w.reminderHint}</span>
          </label>
          {owner ? (
            <div>
              <SubmitButton>{all.common.save}</SubmitButton>
            </div>
          ) : (
            <p className="text-sm text-muted">{all.common.onlyOwner}</p>
          )}
        </ActionForm>
      </section>
    </div>
    </AdminTextScope>
  );
}
