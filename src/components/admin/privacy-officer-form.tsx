import { ActionForm, SubmitButton, type FormState } from "@/components/admin/action-form";
import { fillWords } from "@/lib/admin-fill";
import type { PrivacyOfficerMessages } from "@/lib/admin-messages/privacy-officer.en";
import { officerSummary, type Officer, type OfficerChoice } from "@/lib/privacy-officer";
import type { TeamPerson } from "@/server/privacy-officers";

/**
 * Who the data protection officer is (D763): on Your account for all the account's stores, or on a store's Company page, where the
 * first choice is its account's. Homer picks one line; the person's details show only under "Someone else".
 */

const choiceRow = "flex items-start gap-2 text-sm";

export type PrivacyOfficerFormProps = {
  words: PrivacyOfficerMessages;
  action: (state: FormState, formData: FormData) => Promise<FormState>;
  /** A store's form, whose first choice is its account's officer. */
  store: boolean;
  choice: OfficerChoice;
  people: TeamPerson[];
  /** The officer in force now (a store: its own or its account's). */
  current: Officer | null;
  /** A store's account's officer, for "Same as your account". */
  accountOfficer?: Officer | null;
};

export function PrivacyOfficerForm({ words: w, action, store, choice, people, current, accountOfficer = null }: PrivacyOfficerFormProps) {
  const person = choice.kind === "person" ? choice : null;
  const staffId = choice.kind === "staff" ? choice.accountId : "";
  return (
    <ActionForm action={action} className="flex flex-col gap-3" successMessage={w.saved}>
      <p className="text-sm text-muted">{current ? fillWords(w.current, { who: officerSummary(current) }) : w.currentNone}</p>
      <fieldset className="flex flex-col gap-3">
        <legend className="sr-only">{w.title}</legend>
        {store ? (
          <label className={choiceRow}>
            <input type="radio" name="officer" value="account" defaultChecked={choice.kind === "account"} className="mt-1" />
            <span>{accountOfficer ? fillWords(w.sameAsAccountWho, { who: officerSummary(accountOfficer) }) : w.sameAsAccountNone}</span>
          </label>
        ) : (
          <label className={choiceRow}>
            <input type="radio" name="officer" value="none" defaultChecked={choice.kind === "none"} className="mt-1" />
            <span>{w.none}</span>
          </label>
        )}
        {people.length > 0 ? (
          <div className="flex flex-col gap-2">
            <span className="text-sm">{w.team}</span>
            {people.map((p) => (
              <label key={p.accountId} className={`${choiceRow} pl-4`}>
                <input type="radio" name="officer" value={`staff:${p.accountId}`} defaultChecked={staffId === p.accountId} className="mt-1" />
                <span>{p.name ? `${p.name} (${p.email})` : p.email}</span>
              </label>
            ))}
          </div>
        ) : null}
        <label className={choiceRow}>
          <input type="radio" name="officer" value="person" defaultChecked={choice.kind === "person"} className="mt-1" />
          <span>{w.someoneElse}</span>
        </label>
        <div className="grid gap-3 pl-6 sm:grid-cols-2">
          <label className="flex flex-col gap-1 text-sm">
            {w.name}
            <input name="name" defaultValue={person?.name ?? ""} maxLength={200} className="min-h-10 w-full rounded-md border border-line bg-card px-3 text-sm" />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            {w.email}
            <input type="email" name="email" defaultValue={person?.email ?? ""} maxLength={254} className="min-h-10 w-full rounded-md border border-line bg-card px-3 text-sm" />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            {w.phone}
            <input name="phone" defaultValue={person?.phone ?? ""} maxLength={40} className="min-h-10 w-full rounded-md border border-line bg-card px-3 text-sm" />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            {w.firm}
            <input name="firm" defaultValue={person?.firm ?? ""} maxLength={200} className="min-h-10 w-full rounded-md border border-line bg-card px-3 text-sm" />
          </label>
        </div>
      </fieldset>
      <p className="text-xs text-muted">{w.hint}</p>
      <div>
        <SubmitButton>{w.save}</SubmitButton>
      </div>
    </ActionForm>
  );
}
