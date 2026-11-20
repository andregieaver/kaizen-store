import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { ActionForm, SubmitButton } from "@/components/admin/action-form";
import { requireFeature } from "@/components/admin/feature-off";
import { RuleList } from "@/components/admin/automation/rule-list";
import { Card, PageHeader } from "@/components/admin/ui";
import { countWords } from "@/lib/admin-fill";
import { ADMIN_LANG_FACTS, adminLangOf } from "@/lib/admin-lang";
import { AUTOMATIC_WORDS } from "@/lib/admin-words/automatic";
import { NOTIFICATIONS_WORDS } from "@/lib/admin-words/notifications";
import { listRules } from "@/server/order-rules";
import { memberCan, requirePermission } from "@/server/permissions";
import { moveRulesToWorkflows, rulesMovePlan } from "@/server/rules-to-workflows";

import { deleteRuleAction, moveRuleAction, moveRulesAction, switchRuleAction } from "./actions";
import { ruleContext } from "./rule-context";

export const metadata: Metadata = { title: "Automation" };

/**
 * The store's automation rules (wave 3, D238, `docs/wave-3-notifications.md` 2.5): *when an order is paid and {conditions} then tag, notify or hold*.
 * `settings:read` sees the rules and the log; `settings:write` changes them (each action asks again). Part of the online shop.
 *
 * Rules are folded into workflows (ecosystem plan E3.3, D718): with no rule left this address leads to the workflows; an owner who opens it
 * when every rule can move has them moved at once and is shown the workflows they became; otherwise *Move my rules to workflows* moves those
 * that can, and the page says why the others stay rules (they keep running).
 */
export default async function AutomationPage({ params }: PageProps<"/admin/[store]/settings/automation">) {
  const member = await requirePermission((await params).store, "settings:read");
  const shopOff = requireFeature(member, "shop");
  if (shopOff) return shopOff;
  const { store } = member;
  const lang = adminLangOf(member.account.adminLocale);
  const words = NOTIFICATIONS_WORDS[lang];
  const w = words.rules;
  const canWrite = memberCan(member, "settings:write");
  const plan = await rulesMovePlan(store.id);
  if (plan.moved.length === 0 && plan.kept.length === 0) redirect(`/admin/${store.slug}/settings/workflows`);
  if (plan.kept.length === 0 && canWrite && memberCan(member, "owner")) {
    const outcome = await moveRulesToWorkflows(store.id, member.account.id);
    if (outcome.kept.length === 0) redirect(`/admin/${store.slug}/settings/workflows?moved=${outcome.moved.map((m) => m.id).join(",")}`);
  }
  const [rules, context] = await Promise.all([listRules(store.id), ruleContext(store, lang)]);
  const move = AUTOMATIC_WORDS[lang].move;
  const keptWhy = new Map(plan.kept.map((k) => [k.id, k.why]));
  const kept = rules.filter((r) => keptWhy.has(r.id));
  const movable = rules.length - kept.length;
  const base = `/admin/${store.slug}/settings/automation`;
  const when = (iso: string) => new Date(iso).toLocaleString(ADMIN_LANG_FACTS[lang].locale, { dateStyle: "medium", timeStyle: "short", timeZone: store.timeZone });
  return (
    <>
    <div className="flex flex-col gap-6">
      <PageHeader
        title={w.title}
        description={<>{w.description}</>}
        actions={
          // No *New rule* since the fold (E3.3): a new one is a workflow.
          <Link href={`${base}/log`} className="inline-flex min-h-10 items-center rounded-pill border border-edge px-4 text-sm">
            {w.log}
          </Link>
        }
      />
      <Card title={move.title} description={move.description}>
        <div className="flex flex-col gap-3">
          {movable > 0 && <p className="text-body text-ink">{countWords(movable, move.canMove)}</p>}
          {movable > 0 &&
            (canWrite ? (
              <ActionForm action={moveRulesAction.bind(null, store.slug)} successMessage={words.common.saved}>
                <div>
                  <SubmitButton>{move.button}</SubmitButton>
                </div>
              </ActionForm>
            ) : (
              <p className="text-body text-muted">{move.readOnly}</p>
            ))}
          {kept.length > 0 && (
            <div className="flex flex-col gap-1">
              <p className="text-body text-ink">{move.staysTitle}</p>
              <ul className="list-disc pl-5 text-body text-muted">
                {kept.map((r) => (
                  <li key={r.id}>
                    <span className="text-ink">{r.name}</span>: {move.why[keptWhy.get(r.id) ?? "invalid"]}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </Card>
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
    </>
  );
}
