import Link from "next/link";

import { ActionForm, SubmitButton, type FormState } from "@/components/admin/action-form";
import { Card, Chip, List, ListRow, RowActions, RowLead } from "@/components/admin/ui";
import { fillWords } from "@/lib/admin-fill";
import { notificationsEn, type NotificationsMessages } from "@/lib/admin-messages/notifications.en";
import { NOTIFICATION_GROUPS, notificationPath, type NotificationGroup } from "@/lib/notifications";
import type { NotificationListItem } from "@/server/notifications";

import { languageLabel } from "./language-label";

type SwitchAction = (state: FormState, form: FormData) => Promise<FormState>;

const SIGNAL: Record<NotificationListItem["status"], "positive" | "neutral" | "insight"> = { on: "positive", off: "neutral", always: "insight", fixed: "insight" };

/** A notification's name, when it is sent and why it is required, in the admin's words (`NOTIFICATIONS` in English). */
export function notificationWords(def: { id: string; label: string; when: string; why: string | null }, w: NotificationsMessages = notificationsEn) {
  const own = w.emails.defs[def.id];
  return { label: own?.label ?? def.label, when: own?.when ?? def.when, why: own ? own.why || null : def.why };
}

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
  words = notificationsEn,
  display = "en",
}: {
  items: NotificationListItem[];
  /** `/admin/{store}/settings/notifications`. */
  base: string;
  /** The bound switch action of a notification, or null when the person may not change settings. */
  switchAction: ((id: string) => SwitchAction) | null;
  /** Whether the store offers pickup or local delivery (the group of their emails is then in use). */
  handovers: boolean;
  /** The admin's words in the account's language; English unless given. */
  words?: NotificationsMessages;
  /** The language languages are named in (`Intl.DisplayNames`). */
  display?: string;
}) {
  const groups = NOTIFICATION_GROUPS.map((group) => ({ group, rows: items.filter((i) => i.def.group === group) })).filter((g) => g.rows.length > 0);
  return (
    <div className="flex flex-col gap-6">
      {groups.map(({ group, rows }) => (
        <Card key={group} title={words.emails.groups[group]} description={groupNote(group, handovers, words)}>
          <List label={words.emails.groups[group]}>
            {rows.map((item) => (
              <NotificationRow key={item.def.id} item={item} base={base} switchAction={switchAction} words={words} display={display} />
            ))}
          </List>
        </Card>
      ))}
    </div>
  );
}

function groupNote(group: NotificationGroup, handovers: boolean, w: NotificationsMessages): string | undefined {
  if (group !== "pickup") return undefined;
  return handovers ? w.emails.pickupOn : w.emails.pickupOff;
}

function NotificationRow({
  item,
  base,
  switchAction,
  words,
  display,
}: {
  item: NotificationListItem;
  base: string;
  switchAction: ((id: string) => SwitchAction) | null;
  words: NotificationsMessages;
  display: string;
}) {
  const { def } = item;
  const shown = notificationWords(def, words);
  const w = words.emails;
  const c = words.common;
  const href = `${base}/${notificationPath(def.id)}`;
  const languages = item.languages.filter((l) => l.offered || l.own);
  return (
    <ListRow>
      <RowLead
        title={shown.label}
        href={href}
        sub={
          <>
            {shown.when}
            {def.required && shown.why && <span className="block">{fillWords(w.alwaysSent, { why: shown.why })}</span>}
            {languages.length > 0 && (
              <span className="mt-1 flex flex-wrap gap-x-3 gap-y-1">
                {languages.map((l) => (
                  <span key={l.lang}>
                    {languageLabel(l.lang, display)}: {l.own ? (l.invalid ? w.yourTextProblem : w.yourText) : w.standardText}
                    {!l.offered && w.noLongerOffered}
                  </span>
                ))}
              </span>
            )}
          </>
        }
      />
      <RowActions>
        <Chip signal={SIGNAL[item.status]} dot>
          {w.status[item.status]}
        </Chip>
        {switchAction && !def.required && (
          <ActionForm action={switchAction(def.id)} successMessage={item.enabled ? c.switchedOff : c.switchedOn} className="flex items-center gap-2">
            <input type="hidden" name="enabled" value={item.enabled ? "off" : "on"} />
            <SubmitButton variant="secondary">
              {item.enabled ? c.switchOff : c.switchOn}
              <span className="sr-only"> {shown.label}</span>
            </SubmitButton>
          </ActionForm>
        )}
        <Link href={href} className="inline-flex min-h-10 items-center rounded-pill px-3 text-sm text-ink-2 hover:bg-sunken hover:text-ink">
          {def.editable ? c.edit : c.view}
          <span className="sr-only"> {shown.label}</span>
        </Link>
      </RowActions>
    </ListRow>
  );
}
