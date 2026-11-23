import { fillWords } from "@/lib/admin-fill";
import type { SendAllowanceMessages } from "@/lib/admin-messages/send-allowance.en";
import { allowanceVerdict, type SendAllowance } from "@/lib/send-allowance";

import { ActionForm, SubmitButton, type FormState } from "./action-form";
import { Card } from "./ui";

/**
 * Email automation's send allowance (D876, D748 E10 part three) where newsletters are written: nothing while the account is well inside its
 * size; at 80 % of its contacts or its emails of the month, what it has used and one press to move up; at the limit, that new newsletters
 * wait while flows and order emails keep sending. The press is the account owner's; anyone else is told who can.
 */
export function SendAllowanceNotice({
  allowance,
  words: w,
  locale,
  moveUp,
  always = false,
}: {
  allowance: SendAllowance | null;
  words: SendAllowanceMessages;
  /** The number locale of the person's language. */
  locale: string;
  /** Null for someone who is not the account's owner. */
  moveUp: ((state: FormState, form: FormData) => Promise<FormState>) | null;
  /** Shown while well inside the size too (Account, Extensions), with what is used and the next size. */
  always?: boolean;
}) {
  if (!allowance) return null;
  const verdict = allowanceVerdict(allowance);
  if (verdict === "fine" && !always) return null;
  const n = (value: number | null) => (value === null ? w.noLimit : value.toLocaleString(locale));
  const usage = fillWords(w.usage, {
    emails: n(allowance.emails),
    emailsAllowed: n(allowance.emailsAllowed),
    contacts: n(allowance.contacts),
    contactsAllowed: n(allowance.contactsAllowed),
  });
  return (
    <Card title={verdict === "over" ? w.over : verdict === "near" ? w.near : w.title} description={usage} className={verdict === "over" ? "border border-warning-line" : undefined}>
      {!allowance.next ? (
        <p className="text-sm text-muted">{w.biggest}</p>
      ) : moveUp ? (
        <ActionForm action={moveUp}>
          <SubmitButton>{allowance.next.contacts === null ? w.moveUpAny : fillWords(w.moveUp, { contacts: n(allowance.next.contacts) })}</SubmitButton>
        </ActionForm>
      ) : (
        <p className="text-sm text-muted">{w.askOwner}</p>
      )}
    </Card>
  );
}
