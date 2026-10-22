import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { requireFeature } from "@/components/admin/feature-off";
import { RuleEditor } from "@/components/admin/automation/rule-editor";
import { AdminTextScope } from "@/components/admin/admin-text";
import { PageHeader } from "@/components/admin/ui";
import { adminLangOf } from "@/lib/admin-lang";
import { adminText, adminTexts } from "@/lib/admin-text";
import { memberCan, requirePermission } from "@/server/permissions";
import { tagSuggestions } from "@/server/order-tags";

import { saveRuleAction } from "../actions";
import { ruleContext } from "../rule-context";

export const metadata: Metadata = { title: "New automation rule" };

/** A new automation rule (wave 3, D238, 2.5 point 2): `settings:write`, as making one changes the store. */
export default async function NewRulePage({ params }: PageProps<"/admin/[store]/settings/automation/new">) {
  const member = await requirePermission((await params).store, "settings:read");
  const shopOff = requireFeature(member, "shop");
  if (shopOff) return shopOff;
  const { store } = member;
  const lang = adminLangOf(member.account.adminLocale);
  const words = adminText(lang, "notifications");
  const w = words.rules;
  if (!memberCan(member, "settings:write")) notFound();
  const [context, tags] = await Promise.all([ruleContext(store, lang), tagSuggestions(store.id)]);
  const back = `/admin/${store.slug}/settings/automation`;
  return (
    <AdminTextScope texts={adminTexts(lang, ["notifications"])}>
    <div className="flex flex-col gap-6">
      <PageHeader back={{ href: back, label: w.title }} title={w.newTitle} description={<>{w.newDescription}</>} />
      <RuleEditor
        rule={null}
        currency={context.currency}
        countries={context.countries}
        products={context.products}
        tags={tags.map((t) => t.label)}
        save={saveRuleAction.bind(null, store.slug, null)}
        back={back}
        canWrite
      />
    </div>
    </AdminTextScope>
  );
}
