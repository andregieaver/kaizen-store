import { ActionForm, SubmitButton, type FormState } from "@/components/admin/action-form";
import { Card, Chip, List, ListRow, RowActions, RowLead } from "@/components/admin/ui";
import { fillWords } from "@/lib/admin-fill";
import { notificationsEn, type NotificationsMessages } from "@/lib/admin-messages/notifications.en";
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
export function RuleList({
  rules,
  base,
  describe,
  when,
  actions,
  words = notificationsEn,
}: {
  rules: RuleRow[];
  base: string;
  describe: DescribeContext;
  when: (iso: string) => string;
  actions: RuleListActions | null;
  /** The admin's words in the account's language; English unless given. */
  words?: NotificationsMessages;
}) {
  const w = words.rules;
  const c = words.common;
  if (rules.length === 0) {
    return (
      <Card title={w.list}>
        <p className="text-body text-muted">{w.empty}</p>
      </Card>
    );
  }
  return (
    <Card title={w.list} count={rules.length}>
      <List label={w.list}>
        {rules.map((rule, i) => (
          <ListRow key={rule.id}>
            <RowLead
              title={rule.name}
              href={`${base}/${rule.id}`}
              sub={
                <>
                  {describeRule(rule, describe, w.sentence)}
                  <span className="block">{rule.lastRun ? fillWords(w.lastRan, { when: when(rule.lastRun.at), result: rule.lastRun.matched ? w.matched : w.notMatched }) : w.notRun}</span>
                </>
              }
            />
            <RowActions>
              <Chip signal={rule.enabled ? "positive" : "neutral"} dot>
                {rule.enabled ? c.on : c.off}
              </Chip>
              {actions && (
                <>
                  <ActionForm action={actions.switchRule(rule.id)} successMessage={rule.enabled ? c.switchedOff : c.switchedOn} className="flex items-center">
                    <input type="hidden" name="enabled" value={rule.enabled ? "off" : "on"} />
                    <SubmitButton variant="secondary">
                      {rule.enabled ? c.switchOff : c.switchOn}
                      <span className="sr-only"> {rule.name}</span>
                    </SubmitButton>
                  </ActionForm>
                  {i > 0 && (
                    <ActionForm action={actions.move(rule.id, "up")} successMessage={w.moved} className="flex items-center">
                      <SubmitButton variant="secondary">
                        {w.moveUp}<span className="sr-only"> {rule.name}</span>
                      </SubmitButton>
                    </ActionForm>
                  )}
                  {i < rules.length - 1 && (
                    <ActionForm action={actions.move(rule.id, "down")} successMessage={w.moved} className="flex items-center">
                      <SubmitButton variant="secondary">
                        {w.moveDown}<span className="sr-only"> {rule.name}</span>
                      </SubmitButton>
                    </ActionForm>
                  )}
                  <ActionForm action={actions.remove(rule.id)} successMessage={w.deleted} className="flex items-center">
                    <input type="hidden" name="confirm" value="1" />
                    <SubmitButton variant="secondary">
                      {w.delete}<span className="sr-only"> {rule.name}</span>
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
