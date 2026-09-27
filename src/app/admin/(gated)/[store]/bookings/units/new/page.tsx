import type { Metadata } from "next";
import Link from "next/link";

import { requireMember } from "@/server/auth";
import { hostChoices } from "@/server/hosts";

import { saveUnitAction } from "../../actions";
import { UnitForm } from "../unit-form";

export const metadata: Metadata = { title: "Add a room or item" };

export default async function NewUnitPage({ params, searchParams }: PageProps<"/admin/[store]/bookings/units/new">) {
  const { store } = await requireMember((await params).store);
  const kind = (await searchParams).kind === "item" ? "item" : "unit";
  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <div>
        <Link href={`/admin/${store.slug}/bookings/units`} className="text-sm underline">
          Rooms and rental items
        </Link>
        <h1 className="text-2xl font-semibold">{kind === "unit" ? "Add a room or home" : "Add a rental item"}</h1>
      </div>
      <UnitForm kind={kind} unit={null} hosts={await hostChoices(store.id)} action={saveUnitAction.bind(null, store.slug, kind, null)} />
    </div>
  );
}
