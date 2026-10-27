import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { z } from "zod";

import { AdminTextScope } from "@/components/admin/admin-text";
import { ContentTypeChoices } from "@/components/admin/content-type-choices";
import { DeleteDiscountButton } from "@/components/admin/delete-discount-button";
import { countWords } from "@/lib/admin-fill";
import { ADMIN_LANG_FACTS, adminLangOf } from "@/lib/admin-lang";
import { adminText, adminTexts } from "@/lib/admin-text";
import { FieldGroupEditor } from "@/components/admin/field-group-editor";
import { groupToInput } from "@/lib/custom-fields";
import { moneyCurrencies } from "@/lib/field-money";
import { contentTypeChoices } from "@/server/content-types";
import { requirePermission } from "@/server/permissions";
import { getFieldGroup } from "@/server/custom-fields";

import { deleteFieldGroupAction, saveFieldGroupAction } from "../actions";
import { editorTerms, roleOptions, storeLanguages } from "../data";
import { featureOn } from "@/lib/store-features";
import { PageHeader } from "@/components/admin/ui";

export const metadata: Metadata = { title: "Group of custom fields" };

export default async function FieldGroupPage({ params }: PageProps<"/admin/[store]/fields/[groupId]">) {
  const { store: slug, groupId } = await params;
  const { store, account } = await requirePermission(slug, "products:read");
  const lang = adminLangOf(account.adminLocale);
  const t = adminText(lang, "fields").list;
  if (!z.uuid().safeParse(groupId).success) notFound();
  const [group, terms] = await Promise.all([getFieldGroup(store.id, groupId), editorTerms(store.id)]);
  if (!group) notFound();
  const base = `/admin/${store.slug}/fields`;
  return (
    <AdminTextScope texts={adminTexts(lang, ["fields"])}>
    <div className="flex flex-col gap-6">
      <PageHeader
        back={{ href: base, label: t.title }}
        title={<>{group.name}</>}
        description={<>{group.active ? t.switchedOn : t.switchedOff}</>}
      />
      <ContentTypeChoices types={await contentTypeChoices(store.id)}>
        <FieldGroupEditor
          initial={groupToInput(group)}
          terms={terms}
          roles={roleOptions()}
          languages={storeLanguages(store, ADMIN_LANG_FACTS[lang].locale)}
          currencies={moneyCurrencies(store)}
          sellsToBusinesses={featureOn(store, "business")}
          save={saveFieldGroupAction.bind(null, store.slug)}
          base={base}
          actions={
            <DeleteDiscountButton
              action={deleteFieldGroupAction.bind(null, store.slug, group.id)}
              code={group.name}
              label={t.deleteGroup}
              question={countWords(group.fields.length, t.deleteQuestion, { name: group.name })}
            />
          }
        />
      </ContentTypeChoices>
    </div>
    </AdminTextScope>
  );
}
