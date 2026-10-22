import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { requireFeature } from "@/components/admin/feature-off";
import { RuleEditor } from "@/components/admin/automation/rule-editor";
import { AdminTextScope } from "@/components/admin/admin-text";
import { Chip, PageHeader } from "@/components/admin/ui";
import { fillWords } from "@/lib/admin-fill";
import { adminLangOf } from "@/lib/admin-lang";
import { adminText, adminTexts } from "@/lib/admin-text";
import { getRule } from "@/server/order-rules";
import { tagSuggestions } from "@/server/order-tags";
import { memberCan, requirePermission } from "@/server/permissions";

import { saveRuleAction } from "../actions";
import { ruleContext } from "../rule-context";

export const metadata: Metadata = { title: "Automation rule" };

/** One automation rule (wave 3, D238, 2.5 point 2): `settings:read` sees it, `settings:write` changes it. Another store's rule, or none, is a 404. */
export default async function RulePage({ params }: PageProps<"/admin/[store]/settings/automation/[ruleId]">) {
  const { store: slug, ruleId } = await params;
  const member = await requirePermission(slug, "settings:read");
  const shopOff = requireFeature(member, "shop");
  if (shopOff) return shopOff;
  const { store } = member;
  const lang = adminLangOf(member.account.adminLocale);
  const words = adminText(lang, "notifications");
  const w = words.rules;
  const rule = await getRule(store.id, ruleId);
  if (!rule) notFound();
  const canWrite = memberCan(member, "settings:write");
  const [context, tags] = await Promise.all([ruleContext(store, lang), tagSuggestions(store.id)]);
  const back = `/admin/${store.slug}/settings/automation`;
  return (
    <AdminTextScope texts={adminTexts(lang, ["notifications"])}>
    <div className="flex flex-col gap-6">
      <PageHeader
        back={{ href: back, label: w.title }}
        title={rule.name}
        status={<Chip signal={rule.enabled ? "positive" : "neutral"} dot>{rule.enabled ? words.common.on : words.common.off}</Chip>}
        meta={[fillWords(w.version, { n: rule.version })]}
        actions={
          <Link href={`${back}/log?rule=${rule.id}`} className="inline-flex min-h-10 items-center rounded-pill border border-edge px-4 text-sm">
            {w.thisRulesRuns}
          </Link>
        }
      />
      <RuleEditor
        rule={rule}
        currency={context.currency}
        countries={context.countries}
        products={context.products}
        tags={tags.map((t) => t.label)}
        save={canWrite ? saveRuleAction.bind(null, store.slug, rule.id) : null}
        back={back}
        canWrite={canWrite}
      />
      {!canWrite && <p className="text-sm text-muted">{w.ruleReadOnly}</p>}
    </div>
    </AdminTextScope>
  );
}
