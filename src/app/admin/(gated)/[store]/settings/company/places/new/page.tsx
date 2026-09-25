import type { Metadata } from "next";
import Link from "next/link";

import { ActionForm, SubmitButton } from "@/components/admin/action-form";
import { HoursEditor } from "@/components/admin/hours-editor";
import { PlaceFields } from "@/components/admin/place-fields";
import { requireMember } from "@/server/auth";
import { KIND_LABELS } from "@/server/company";
import { listCountries } from "@/server/stores";

import { savePlaceAction } from "../../actions";

export const metadata: Metadata = { title: "Add a place" };

const field = "flex flex-col gap-1 text-sm font-medium";
const control = "min-h-10 rounded-md border border-border bg-background px-3 font-normal";

/** A new store or pickup point (D40). */
export default async function NewPlacePage({ params, searchParams }: PageProps<"/admin/[store]/settings/company/places/new">) {
  const { store } = await requireMember((await params).store);
  const kind = (await searchParams).kind === "pickup" ? "pickup" : "shop";
  const countries = await listCountries();
  const what = kind === "shop" ? "store" : "pickup point";

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <div>
        <Link href={`/admin/${store.slug}/settings/company`} className="text-sm underline">
          Company
        </Link>
        <h1 className="text-2xl font-semibold">Add a {what}</h1>
        <p className="text-sm text-muted">
          {kind === "shop" ? "A place where shoppers can visit you." : "A place where shoppers can collect their orders."}
        </p>
      </div>
      <ActionForm action={savePlaceAction.bind(null, store.slug, null)} className="flex flex-col gap-4 rounded-lg border border-border bg-background p-5">
        <input type="hidden" name="kind" value={kind} />
        <div className={field}>
          <label htmlFor="place-name">Name</label>
          <input
            id="place-name"
            name="name"
            required
            maxLength={80}
            aria-describedby="place-name-hint"
            placeholder={kind === "shop" ? "The shop on Grünerløkka" : "Post i Butikk, Rema 1000 Torshov"}
            className={control}
          />
          <p id="place-name-hint" className="font-normal text-muted">
            What shoppers see, such as the street or the shop it is in.
          </p>
        </div>
        <PlaceFields place={null} countries={countries} defaultCountry={store.details.country ?? "NO"} what={`the ${what}`} />
        <div className="border-t border-border pt-4">
          <h2 className="mb-3 text-sm font-medium">Opening hours</h2>
          <HoursEditor name="hours" initial={null} optional />
        </div>
        <div>
          <SubmitButton>Add {KIND_LABELS[kind].toLowerCase()}</SubmitButton>
        </div>
      </ActionForm>
    </div>
  );
}
