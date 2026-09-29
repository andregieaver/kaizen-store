import type { Metadata } from "next";
import Link from "next/link";

import { FieldGroupEditor } from "@/components/admin/field-group-editor";
import { emptyGroup, isFieldEntity } from "@/lib/custom-fields";
import { moneyCurrencies } from "@/lib/field-money";
import { requireMember } from "@/server/auth";

import { saveFieldGroupAction } from "../actions";
import { editorTerms, roleOptions, storeLanguages } from "../data";

export const metadata: Metadata = { title: "New group of custom fields" };

export default async function NewFieldGroupPage({ params, searchParams }: PageProps<"/admin/[store]/fields/new">) {
  const { store } = await requireMember((await params).store);
  // A link from the store's, a customer's or an order's fields starts a group for that kind of thing.
  const { entity } = await searchParams;
  const start = typeof entity === "string" && isFieldEntity(entity) ? entity : "product";
  const base = `/admin/${store.slug}/fields`;
  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link href={base} className="text-sm underline">
          Custom fields
        </Link>
        <h1 className="text-2xl font-semibold">New group</h1>
      </div>
      <FieldGroupEditor
        initial={emptyGroup(start)}
        terms={await editorTerms(store.id)}
        roles={roleOptions()}
        languages={storeLanguages(store)}
        currencies={moneyCurrencies(store)}
        save={saveFieldGroupAction.bind(null, store.slug)}
        base={base}
      />
    </div>
  );
}
