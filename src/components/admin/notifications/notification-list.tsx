import Link from "next/link";

import { ActionForm, type FormState } from "@/components/admin/action-form";
import { SwitchButton } from "@/components/admin/notifications/switch-button";
import { PhoneRow, PhoneRows } from "@/components/admin/phone-row";
import { countWords } from "@/lib/admin-fill";
import { notificationsEn, type NotificationsMessages } from "@/lib/admin-messages/notifications.en";
import { NOTIFICATION_GROUPS, notificationPath, type NotificationGroup } from "@/lib/notifications";
import type { NotificationListItem } from "@/server/notifications";


type SwitchAction = (state: FormState, form: FormData) => Promise<FormState>;

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
  /** Kept for callers; the languages are named on each email's own page since round 22. */
  display?: string;
}) {
  const groups = NOTIFICATION_GROUPS.map((group) => ({ group, rows: items.filter((i) => i.def.group === group) })).filter((g) => g.rows.length > 0);
  // Round 22 (D687): each group says how many of its emails go out, and each email is one line: its name, and its switch or Always.
  // Round 41 (D737): on a phone each group is a row of one card, saying how many of its emails go out, opening its list.
  return (
    <PhoneRows>
      {groups.map(({ group, rows }, i) => {
        const on = rows.filter((r) => r.status !== "off").length;
        const note = groupNote(group, handovers, words);
        const count = countWords(rows.length, words.emails.groupCount, { on });
        return (
          <PhoneRow
            key={group}
            flat
            last={i === groups.length - 1}
            title={words.emails.groups[group]}
            sub={group === "pickup" && !handovers ? `${count} · ${words.emails.phone.noneOffered}` : count}
            change={words.emails.phone.open}
            done={words.emails.phone.close}
          >
          <section aria-label={words.emails.groups[group]} className="flex flex-col gap-2">
            <div className="flex flex-col gap-0.5 px-1 max-sm:px-0">
              <h2 className="text-body-strong text-ink max-sm:sr-only">
                {words.emails.groups[group]} <span className="font-normal text-ink-2">· {countWords(rows.length, words.emails.groupCount, { on })}</span>
              </h2>
              {note && <p className="text-caption text-ink-2">{note}</p>}
            </div>
            <ul className="divide-y divide-line rounded-lg border border-line bg-card px-4 sm:px-5 max-sm:rounded-none max-sm:border-0 max-sm:px-0">
              {rows.map((item) => (
                <NotificationRow key={item.def.id} item={item} base={base} switchAction={switchAction} words={words} />
              ))}
            </ul>
          </section>
          </PhoneRow>
        );
      })}
    </PhoneRows>
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
}: {
  item: NotificationListItem;
  base: string;
  switchAction: ((id: string) => SwitchAction) | null;
  words: NotificationsMessages;
}) {
  const { def } = item;
  const shown = notificationWords(def, words);
  const w = words.emails;
  const c = words.common;
  const href = `${base}/${notificationPath(def.id)}`;
  // The store's own words in a language it offers (or a problem with them) is the one fact kept beside the name; the rest is on the email's page.
  const own = item.languages.filter((l) => l.own);
  const problem = own.some((l) => l.invalid);
  return (
    <li className="flex min-h-14 items-center gap-3 py-2">
      <Link href={href} className="flex min-w-0 flex-1 flex-col py-1 text-body text-ink hover:underline">
        {shown.label}
        {own.length > 0 && <span className={`text-caption ${problem ? "text-danger-text" : "text-ink-2"}`}>{problem ? w.yourTextProblem : w.yourWords}</span>}
      </Link>
      {def.required ? (
        <span className="shrink-0 text-caption text-ink-2">{w.status[item.status]}</span>
      ) : switchAction ? (
        <ActionForm action={switchAction(def.id)} successMessage={item.enabled ? c.switchedOff : c.switchedOn} className="flex shrink-0 items-center gap-2">
          <input type="hidden" name="enabled" value={item.enabled ? "off" : "on"} />
          <SwitchButton on={item.enabled} label={`${item.enabled ? c.switchOff : c.switchOn} ${shown.label}`} />
        </ActionForm>
      ) : (
        <span className="shrink-0 text-caption text-ink-2">{w.status[item.status]}</span>
      )}
    </li>
  );
}
