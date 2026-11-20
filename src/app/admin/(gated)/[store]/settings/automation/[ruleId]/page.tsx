import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { requireFeature } from "@/components/admin/feature-off";
import { RuleEditor } from "@/components/admin/automation/rule-editor";
import { AdminTextScope } from "@/components/admin/admin-text";
import { Chip, PageHeader } from "@/components/admin/ui";
import { fillWords } from "@/lib/admin-fill";
import { adminLangOf } from "@/lib/admin-lang";
import { areaTexts } from "@/lib/admin-area";
import { NOTIFICATIONS_WORDS } from "@/lib/admin-words/notifications";
import { getRule } from "@/server/order-rules";
import { getWorkflow } from "@/server/workflows";
import { tagSuggestions } from "@/server/order-tags";
import { memberCan, requirePermission } from "@/server/permissions";

import { saveRuleAction } from "../actions";
import { ruleContext } from "../rule-context";

export const metadata: Metadata = { title: "Automation rule" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** One automation rule (wave 3, D238, 2.5 point 2): `settings:read` sees it, `settings:write` changes it. Another store's rule, or none, is a 404. */
export default async function RulePage({ params }: PageProps<"/admin/[store]/settings/automation/[ruleId]">) {
  const { store: slug, ruleId } = await params;
  const member = await requirePermission(slug, "settings:read");
  const shopOff = requireFeature(member, "shop");
  if (shopOff) return shopOff;
  const { store } = member;
  const lang = adminLangOf(member.account.adminLocale);
  const words = NOTIFICATIONS_WORDS[lang];
  const w = words.rules;
  const rule = await getRule(store.id, ruleId);
  // A rule moved to a workflow (ecosystem plan E3.3, D718) is the workflow with its id now: its old address leads there.
  if (!rule && UUID.test(ruleId) && (await getWorkflow(store.id, ruleId))) redirect(`/admin/${store.slug}/settings/workflows`);
  if (!rule) notFound();
  const canWrite = memberCan(member, "settings:write");
  const [context, tags] = await Promise.all([ruleContext(store, lang), tagSuggestions(store.id)]);
  const back = `/admin/${store.slug}/settings/automation`;
  return (
    <AdminTextScope texts={areaTexts(lang, { notifications: NOTIFICATIONS_WORDS })}>
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
