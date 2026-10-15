import { ActionForm, SubmitButton, type FormState } from "@/components/admin/action-form";
import { Card, Chip, List, ListRow, RowActions, RowLead } from "@/components/admin/ui";
import { describeRule, type DescribeContext, type OrderRule } from "@/lib/order-rules";

type FormAction = (state: FormState, form: FormData) => Promise<FormState>;

export type RuleRow = OrderRule & { lastRun: { at: string; matched: boolean } | null };

export type RuleListActions = {
  switchRule: (id: string) => FormAction;
  move: (id: string, direction: "up" | "down") => FormAction;
  remove: (id: string) => FormAction;
};

/**
 * The store's automation rules in their order (wave 3, D238, `docs/wave-3-notifications.md` 2.5 point 1): each with its name, whether it is on, the
 * sentence code writes from it and its last run; *Move up*, *Move down*, the switch and *Delete* for those who may change settings (every action asks
 * again). Works without a script: each button is a form.
 */
export function RuleList({ rules, base, describe, when, actions }: { rules: RuleRow[]; base: string; describe: DescribeContext; when: (iso: string) => string; actions: RuleListActions | null }) {
  if (rules.length === 0) {
    return (
      <Card title="Rules">
        <p className="text-body text-muted">No rules yet. A rule runs once when an order is paid: for example, tag every order over an amount, or hold orders to a country until someone has looked at them.</p>
      </Card>
    );
  }
  return (
    <Card title="Rules" count={rules.length}>
      <List label="Rules">
        {rules.map((rule, i) => (
          <ListRow key={rule.id}>
            <RowLead
              title={rule.name}
              href={`${base}/${rule.id}`}
              sub={
                <>
                  {describeRule(rule, describe)}
                  <span className="block">{rule.lastRun ? `Last ran ${when(rule.lastRun.at)}: ${rule.lastRun.matched ? "matched" : "did not match"}.` : "Has not run yet."}</span>
                </>
              }
            />
            <RowActions>
              <Chip signal={rule.enabled ? "positive" : "neutral"} dot>
                {rule.enabled ? "On" : "Off"}
              </Chip>
              {actions && (
                <>
                  <ActionForm action={actions.switchRule(rule.id)} successMessage={rule.enabled ? "Switched off." : "Switched on."} className="flex items-center">
                    <input type="hidden" name="enabled" value={rule.enabled ? "off" : "on"} />
                    <SubmitButton variant="secondary">
                      {rule.enabled ? "Switch off" : "Switch on"}
                      <span className="sr-only"> {rule.name}</span>
                    </SubmitButton>
                  </ActionForm>
                  {i > 0 && (
                    <ActionForm action={actions.move(rule.id, "up")} successMessage="Moved." className="flex items-center">
                      <SubmitButton variant="secondary">
                        Move up<span className="sr-only"> {rule.name}</span>
                      </SubmitButton>
                    </ActionForm>
                  )}
                  {i < rules.length - 1 && (
                    <ActionForm action={actions.move(rule.id, "down")} successMessage="Moved." className="flex items-center">
                      <SubmitButton variant="secondary">
                        Move down<span className="sr-only"> {rule.name}</span>
                      </SubmitButton>
                    </ActionForm>
                  )}
                  <ActionForm action={actions.remove(rule.id)} successMessage="Deleted." className="flex items-center">
                    <input type="hidden" name="confirm" value="1" />
                    <SubmitButton variant="secondary">
                      Delete<span className="sr-only"> {rule.name}</span>
                    </SubmitButton>
                  </ActionForm>
                </>
              )}
            </RowActions>
          </ListRow>
        ))}
      </List>
    </Card>
  );
}
