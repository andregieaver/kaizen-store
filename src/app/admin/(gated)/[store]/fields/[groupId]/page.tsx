import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";

import { DeleteDiscountButton } from "@/components/admin/delete-discount-button";
import { FieldGroupEditor } from "@/components/admin/field-group-editor";
import { groupToInput } from "@/lib/custom-fields";
import { moneyCurrencies } from "@/lib/field-money";
import { requireMember } from "@/server/auth";
import { getFieldGroup } from "@/server/custom-fields";

import { deleteFieldGroupAction, saveFieldGroupAction } from "../actions";
import { editorTerms, roleOptions, storeLanguages } from "../data";

export const metadata: Metadata = { title: "Group of custom fields" };

export default async function FieldGroupPage({ params }: PageProps<"/admin/[store]/fields/[groupId]">) {
  const { store: slug, groupId } = await params;
  const { store } = await requireMember(slug);
  if (!z.uuid().safeParse(groupId).success) notFound();
  const [group, terms] = await Promise.all([getFieldGroup(store.id, groupId), editorTerms(store.id)]);
  if (!group) notFound();
  const base = `/admin/${store.slug}/fields`;
  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link href={base} className="text-sm underline">
          Custom fields
        </Link>
        <h1 className="text-2xl font-semibold">{group.name}</h1>
        <p className="text-sm text-muted">{group.active ? "Switched on." : "Switched off."}</p>
      </div>
      <FieldGroupEditor
        initial={groupToInput(group)}
        terms={terms}
        roles={roleOptions()}
        languages={storeLanguages(store)}
        currencies={moneyCurrencies(store)}
        save={saveFieldGroupAction.bind(null, store.slug)}
        base={base}
        actions={
          <DeleteDiscountButton
            action={deleteFieldGroupAction.bind(null, store.slug, group.id)}
            code={group.name}
            label="Delete this group"
            question={`Delete the group ${group.name}? What was entered in its ${group.fields.length === 1 ? "field" : "fields"} is deleted too, for every product, page and article. This cannot be undone.`}
          />
        }
      />
    </div>
  );
}
