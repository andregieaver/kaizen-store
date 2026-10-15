import type { Metadata } from "next";
import Link from "next/link";

import { requireFeature } from "@/components/admin/feature-off";
import { RuleList } from "@/components/admin/automation/rule-list";
import { PageHeader } from "@/components/admin/ui";
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
  const [rules, context] = await Promise.all([listRules(store.id), ruleContext(store)]);
  const canWrite = memberCan(member, "settings:write");
  const base = `/admin/${store.slug}/settings/automation`;
  const when = (iso: string) => new Date(iso).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: store.timeZone });
  const full = rules.length >= RULE_LIMITS.rules;
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Automation"
        description={
          <>
            Rules that run once when an order is paid. When the order matches the conditions you choose, the rule tags it, emails the staff chosen for
            Automation under Staff alerts, or holds it so it is not sent until someone releases it. Rules run in this order and do not trigger each other.
          </>
        }
        actions={
          <>
            <Link href={`${base}/log`} className="inline-flex min-h-10 items-center rounded-pill border border-edge px-4 text-sm">
              Log
            </Link>
            {canWrite && !full && (
              <Link href={`${base}/new`} className="inline-flex min-h-10 items-center rounded-pill bg-brand px-4 text-sm font-medium text-brand-ink">
                New rule
              </Link>
            )}
          </>
        }
      />
      {full && <p className="text-sm text-muted">The store has {RULE_LIMITS.rules} rules, the most it can have. Delete one to add another.</p>}
      <RuleList
        rules={rules}
        base={base}
        describe={context.describe}
        when={when}
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
      {!canWrite && <p className="text-sm text-muted">You can see the rules but not change them.</p>}
    </div>
  );
}
