import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { z } from "zod";

import { ActionForm, SubmitButton } from "@/components/admin/action-form";
import { DeleteDiscountButton } from "@/components/admin/delete-discount-button";
import { HoursEditor } from "@/components/admin/hours-editor";
import { PlaceFields } from "@/components/admin/place-fields";
import { requirePermission } from "@/server/permissions";
import { getLocation, KIND_LABELS } from "@/server/company";
import { listCountries } from "@/server/stores";
import { CARD_CLASS, PageHeader } from "@/components/admin/ui";

import { deletePlaceAction, savePlaceAction } from "../../actions";

export const metadata: Metadata = { title: "Place" };

const field = "flex flex-col gap-1 text-sm font-medium";
const control = "min-h-10 rounded-md border border-line bg-card px-3 font-normal";

/** A store or pickup point (D40): its address, directions and opening hours. */
export default async function PlacePage({ params }: PageProps<"/admin/[store]/settings/company/places/[placeId]">) {
  const { store: slug, placeId } = await params;
  const { store } = await requirePermission(slug, "settings:read");
  if (!z.uuid().safeParse(placeId).success) notFound();
  const [place, countries] = await Promise.all([getLocation(store.id, placeId), listCountries()]);
  if (!place || place.kind === "office") notFound();
  const what = KIND_LABELS[place.kind].toLowerCase();

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        back={{ href: `/admin/${store.slug}/settings/company`, label: "Company" }}
        title={<>{place.name}</>}
        description={<>{KIND_LABELS[place.kind]}</>}
      />
      <ActionForm
        action={savePlaceAction.bind(null, store.slug, place.id)}
        className={`flex flex-col gap-4 p-5 ${CARD_CLASS}`}
      >
        <input type="hidden" name="kind" value={place.kind} />
        <label className={field}>
          Name
          <input name="name" required maxLength={80} defaultValue={place.name} className={control} />
        </label>
        <PlaceFields place={place} countries={countries} defaultCountry={store.details.country ?? "NO"} what={`the ${what}`} />
        <div className="border-t border-line pt-4">
          <h2 className="mb-3 text-sm font-medium">Opening hours</h2>
          <HoursEditor name="hours" initial={place.hours} optional />
        </div>
        <div>
          <SubmitButton>Save</SubmitButton>
        </div>
      </ActionForm>
      <DeleteDiscountButton
        action={deletePlaceAction.bind(null, store.slug, place.id)}
        code={place.name}
        question={`Delete ${place.name}? Shoppers will no longer see it.`}
        label={`Delete this ${what}`}
      />
    </div>
  );
}
