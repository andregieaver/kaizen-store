import Link from "next/link";

import { ActionForm, SubmitButton, type FormState } from "@/components/admin/action-form";
import { Card, Chip, List, ListRow, RowActions, RowLead } from "@/components/admin/ui";
import { NOTIFICATION_GROUP_LABELS, NOTIFICATION_GROUPS, notificationPath, type NotificationGroup } from "@/lib/notifications";
import type { NotificationListItem } from "@/server/notifications";

import { languageLabel } from "./language-label";

type SwitchAction = (state: FormState, form: FormData) => Promise<FormState>;

const STATUS: Record<NotificationListItem["status"], { words: string; signal: "positive" | "neutral" | "insight" }> = {
  on: { words: "On", signal: "positive" },
  off: { words: "Off", signal: "neutral" },
  always: { words: "Always on", signal: "insight" },
  fixed: { words: "Fixed", signal: "insight" },
};

/**
 * The Notifications page's list (wave 3, D238, `docs/wave-3-notifications.md` 2.1 point 1): every order and return email of `NOTIFICATIONS` in its group,
 * with when it is sent, its state, whether each of the store's languages has the store's own words, and a switch where it may be switched. A required one
 * says why it is always sent; the withdrawal acknowledgement is *Fixed*. The switch is a form per row (`settings:write`); without it the page only reads.
 */
export function NotificationList({
  items,
  base,
  switchAction,
  handovers,
}: {
  items: NotificationListItem[];
  /** `/admin/{store}/settings/notifications`. */
  base: string;
  /** The bound switch action of a notification, or null when the person may not change settings. */
  switchAction: ((id: string) => SwitchAction) | null;
  /** Whether the store offers pickup or local delivery (the group of their emails is then in use). */
  handovers: boolean;
}) {
  const groups = NOTIFICATION_GROUPS.map((group) => ({ group, rows: items.filter((i) => i.def.group === group) })).filter((g) => g.rows.length > 0);
  return (
    <div className="flex flex-col gap-6">
      {groups.map(({ group, rows }) => (
        <Card key={group} title={NOTIFICATION_GROUP_LABELS[group]} description={groupNote(group, handovers)}>
          <List label={NOTIFICATION_GROUP_LABELS[group]}>
            {rows.map((item) => (
              <NotificationRow key={item.def.id} item={item} base={base} switchAction={switchAction} />
            ))}
          </List>
        </Card>
      ))}
    </div>
  );
}

function groupNote(group: NotificationGroup, handovers: boolean): string | undefined {
  if (group !== "pickup") return undefined;
  return handovers
    ? "Sent for orders collected at your places or delivered by your own driver."
    : "The store offers no pickup or local delivery yet, so these are not sent. Set them up under Shipping.";
}

function NotificationRow({ item, base, switchAction }: { item: NotificationListItem; base: string; switchAction: ((id: string) => SwitchAction) | null }) {
  const { def } = item;
  const status = STATUS[item.status];
  const href = `${base}/${notificationPath(def.id)}`;
  const languages = item.languages.filter((l) => l.offered || l.own);
  return (
    <ListRow>
      <RowLead
        title={def.label}
        href={href}
        sub={
          <>
            {def.when}
            {def.required && def.why && <span className="block">Always sent: {def.why}</span>}
            {languages.length > 0 && (
              <span className="mt-1 flex flex-wrap gap-x-3 gap-y-1">
                {languages.map((l) => (
                  <span key={l.lang}>
                    {languageLabel(l.lang)}: {l.own ? (l.invalid ? "your text (a part has a problem, the standard text is used there)" : "your text") : "standard text"}
                    {!l.offered && " (no longer offered)"}
                  </span>
                ))}
              </span>
            )}
          </>
        }
      />
      <RowActions>
        <Chip signal={status.signal} dot>
          {status.words}
        </Chip>
        {switchAction && !def.required && (
          <ActionForm action={switchAction(def.id)} successMessage={item.enabled ? "Switched off." : "Switched on."} className="flex items-center gap-2">
            <input type="hidden" name="enabled" value={item.enabled ? "off" : "on"} />
            <SubmitButton variant="secondary">
              {item.enabled ? "Switch off" : "Switch on"}
              <span className="sr-only"> {def.label}</span>
            </SubmitButton>
          </ActionForm>
        )}
        <Link href={href} className="inline-flex min-h-10 items-center rounded-pill px-3 text-sm text-ink-2 hover:bg-sunken hover:text-ink">
          {def.editable ? "Edit" : "View"}
          <span className="sr-only"> {def.label}</span>
        </Link>
      </RowActions>
    </ListRow>
  );
}
