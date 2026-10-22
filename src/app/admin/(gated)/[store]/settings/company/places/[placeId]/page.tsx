import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { z } from "zod";

import { ActionForm, SubmitButton } from "@/components/admin/action-form";
import { AdminTextScope } from "@/components/admin/admin-text";
import { DeleteDiscountButton } from "@/components/admin/delete-discount-button";
import { HoursEditor } from "@/components/admin/hours-editor";
import { PlaceFields } from "@/components/admin/place-fields";
import { adminLangOf } from "@/lib/admin-lang";
import { adminText, adminTexts } from "@/lib/admin-text";
import { fillWords } from "@/lib/admin-fill";
import { requirePermission } from "@/server/permissions";
import { getLocation } from "@/server/company";
import { listCountries } from "@/server/stores";
import { CARD_CLASS, PageHeader } from "@/components/admin/ui";

import { deletePlaceAction, savePlaceAction } from "../../actions";

export const metadata: Metadata = { title: "Place" };

const field = "flex flex-col gap-1 text-sm font-medium";
const control = "min-h-10 rounded-md border border-line bg-card px-3 font-normal";

/** A store or pickup point (D40): its address, directions and opening hours. */
export default async function PlacePage({ params }: PageProps<"/admin/[store]/settings/company/places/[placeId]">) {
  const { store: slug, placeId } = await params;
  const member = await requirePermission(slug, "settings:read");
  const { store } = member;
  const lang = adminLangOf(member.account.adminLocale);
  const all = adminText(lang, "settings");
  const w = all.company;
  if (!z.uuid().safeParse(placeId).success) notFound();
  const [place, countries] = await Promise.all([getLocation(store.id, placeId), listCountries()]);
  if (!place || place.kind === "office") notFound();
  const kind = place.kind;

  return (
    <AdminTextScope texts={adminTexts(lang, ["settings"])}>
    <div className="flex flex-col gap-6">
      <PageHeader
        back={{ href: `/admin/${store.slug}/settings/company`, label: w.title }}
        title={<>{place.name}</>}
        description={<>{w.kinds[kind]}</>}
      />
      <ActionForm
        action={savePlaceAction.bind(null, store.slug, place.id)}
        className={`flex flex-col gap-4 p-5 ${CARD_CLASS}`}
      >
        <input type="hidden" name="kind" value={place.kind} />
        <label className={field}>
          {w.name}
          <input name="name" required maxLength={80} defaultValue={place.name} className={control} />
        </label>
        <PlaceFields place={place} countries={countries} defaultCountry={store.details.country ?? "NO"} what={w.the[kind]} w={all} />
        <fieldset className="flex flex-col gap-2 border-t border-line pt-4 text-sm">
          <legend className="text-title text-ink">{w.position}</legend>
          <p className="text-muted">{w.positionText}</p>
          <div className="flex flex-wrap gap-4">
            <label className={field}>
              {w.latitude}
              <input name="latitude" inputMode="decimal" defaultValue={place.latitude ?? ""} placeholder="59.9139" className={control} />
            </label>
            <label className={field}>
              {w.longitude}
              <input name="longitude" inputMode="decimal" defaultValue={place.longitude ?? ""} placeholder="10.7522" className={control} />
            </label>
          </div>
        </fieldset>
        <div className="border-t border-line pt-4">
          <h2 className="mb-3 text-title text-ink">{w.openingHours}</h2>
          <HoursEditor name="hours" initial={place.hours} optional />
        </div>
        <div>
          <SubmitButton>{all.common.save}</SubmitButton>
        </div>
      </ActionForm>
      <DeleteDiscountButton
        action={deletePlaceAction.bind(null, store.slug, place.id)}
        code={place.name}
        question={fillWords(w.deleteQuestion, { name: place.name })}
        label={w.deleteKind[kind]}
      />
    </div>
    </AdminTextScope>
  );
}
