import type { Metadata } from "next";
import Link from "next/link";

import { requireFeature } from "@/components/admin/feature-off";
import { AdminTextScope } from "@/components/admin/admin-text";
import { RuleList } from "@/components/admin/automation/rule-list";
import { PageHeader } from "@/components/admin/ui";
import { fillWords } from "@/lib/admin-fill";
import { ADMIN_LANG_FACTS, adminLangOf } from "@/lib/admin-lang";
import { adminText, adminTexts } from "@/lib/admin-text";
import { RULE_LIMITS } from "@/lib/order-rules";
import { listRules } from "@/server/order-rules";
import { memberCan, requirePermission } from "@/server/permissions";

import { deleteRuleAction, moveRuleAction, switchRuleAction } from "./actions";
import { ruleContext } from "./rule-context";

export const metadata: Metadata = { title: "Automation" };

/**
 * The store's automation rules (wave 3, D238, `docs/wave-3-notifications.md` 2.5): *when an order is paid and {conditions} then tag, notify or hold*.
 * `settings:read` sees the rules and the log; `settings:write` changes them (each action asks again). Part of the online shop.
 */
export default async function AutomationPage({ params }: PageProps<"/admin/[store]/settings/automation">) {
  const member = await requirePermission((await params).store, "settings:read");
  const shopOff = requireFeature(member, "shop");
  if (shopOff) return shopOff;
  const { store } = member;
  const lang = adminLangOf(member.account.adminLocale);
  const words = adminText(lang, "notifications");
  const w = words.rules;
  const [rules, context] = await Promise.all([listRules(store.id), ruleContext(store, lang)]);
  const canWrite = memberCan(member, "settings:write");
  const base = `/admin/${store.slug}/settings/automation`;
  const when = (iso: string) => new Date(iso).toLocaleString(ADMIN_LANG_FACTS[lang].locale, { dateStyle: "medium", timeStyle: "short", timeZone: store.timeZone });
  const full = rules.length >= RULE_LIMITS.rules;
  return (
    <AdminTextScope texts={adminTexts(lang, ["notifications"])}>
    <div className="flex flex-col gap-6">
      <PageHeader
        title={w.title}
        description={<>{w.description}</>}
        actions={
          <>
            <Link href={`${base}/log`} className="inline-flex min-h-10 items-center rounded-pill border border-edge px-4 text-sm">
              {w.log}
            </Link>
            {canWrite && !full && (
              <Link href={`${base}/new`} className="inline-flex min-h-10 items-center rounded-pill bg-brand px-4 text-sm font-medium text-brand-ink">
                {w.newRule}
              </Link>
            )}
          </>
        }
      />
      {full && <p className="text-sm text-muted">{fillWords(w.full, { n: RULE_LIMITS.rules })}</p>}
      <RuleList
        rules={rules}
        base={base}
        describe={context.describe}
        when={when}
        words={words}
        actions={
          canWrite
            ? {
                switchRule: (id) => switchRuleAction.bind(null, store.slug, id),
                move: (id, direction) => moveRuleAction.bind(null, store.slug, id, direction),
                remove: (id) => deleteRuleAction.bind(null, store.slug, id),
              }
            : null
        }
      />
      {!canWrite && <p className="text-sm text-muted">{w.readOnly}</p>}
    </div>
    </AdminTextScope>
  );
}
