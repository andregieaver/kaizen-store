import type { Metadata } from "next";

import { PhoneRow } from "@/components/admin/phone-row";
import { ActionForm, SubmitButton } from "@/components/admin/action-form";
import { AdminTextScope } from "@/components/admin/admin-text";
import { HoursEditor } from "@/components/admin/hours-editor";
import { PlaceFields } from "@/components/admin/place-fields";
import { adminLangOf } from "@/lib/admin-lang";
import { areaTexts } from "@/lib/admin-area";
import { SETTINGS_WORDS } from "@/lib/admin-words/settings";
import { SETTINGS_HOURS_WORDS } from "@/lib/admin-words/settings-hours";
import { requirePermission } from "@/server/permissions";
import { listCountries } from "@/server/stores";
import { CARD_CLASS, PageHeader } from "@/components/admin/ui";

import { savePlaceAction } from "../../actions";

export const metadata: Metadata = { title: "Add a place" };

const field = "flex flex-col gap-1 text-sm font-medium";
const control = "min-h-10 rounded-md border border-line bg-card px-3 font-normal";

/** A new store or pickup point (D40). */
export default async function NewPlacePage({ params, searchParams }: PageProps<"/admin/[store]/settings/company/places/new">) {
  const member = await requirePermission((await params).store, "settings:read");
  const { store } = member;
  const lang = adminLangOf(member.account.adminLocale);
  const all = SETTINGS_WORDS[lang];
  const w = all.company;
  const kind = (await searchParams).kind === "pickup" ? "pickup" : "shop";
  const countries = await listCountries();

  return (
    <AdminTextScope texts={areaTexts(lang, { settingsHours: SETTINGS_HOURS_WORDS })}>
    <div className="flex flex-col gap-6">
      <PageHeader back={{ href: `/admin/${store.slug}/settings/company`, label: w.title }} title={<>{w.addTitle[kind]}</>} description={<>{w.addText[kind]}</>} />
      <ActionForm action={savePlaceAction.bind(null, store.slug, null)} className={`flex flex-col gap-4 p-5 ${CARD_CLASS}`}>
        <input type="hidden" name="kind" value={kind} />
        <div className={field}>
          <label htmlFor="place-name">{w.name}</label>
          <input
            id="place-name"
            name="name"
            required
            maxLength={80}
            aria-describedby="place-name-hint"
            placeholder={w.namePlaceholder[kind]}
            className={control}
          />
          <p id="place-name-hint" className="font-normal text-muted max-sm:hidden">
            {w.nameHint}
          </p>
        </div>
        <PlaceFields part="address" place={null} countries={countries} defaultCountry={store.details.country ?? "NO"} what={w.the[kind]} w={all} />
        {/* Round 51 (D784): on a phone the optional phone, directions and opening hours are one row; their fields are sent either way. */}
        <div className="max-sm:border-y max-sm:border-line">
          <PhoneRow inset last title={w.phone.more} sub={all.common.optional} change={w.phone.open} done={w.phone.close}>
            <div className="flex flex-col gap-4">
              <PlaceFields part="extras" place={null} countries={countries} defaultCountry={store.details.country ?? "NO"} what={w.the[kind]} w={all} />
              <div className="border-t border-line pt-4 max-sm:border-0 max-sm:pt-0">
                <h2 className="mb-3 text-title text-ink">{w.openingHours}</h2>
                <HoursEditor name="hours" initial={null} optional />
              </div>
            </div>
          </PhoneRow>
        </div>
        <div>
          <SubmitButton>{w.addKind[kind]}</SubmitButton>
        </div>
      </ActionForm>
    </div>
    </AdminTextScope>
  );
}
