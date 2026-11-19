"use client";

import type { PlatformMessages } from "@/lib/admin-messages/platform.en";

import { ConfirmButton } from "./ui/confirm-button";

/** Deletes a cart reminder after asking in the admin's dialog (`ConfirmButton`, code review 1.12); carts already reminded keep their history. */
export function DeleteReminderButton({
  action,
  words,
}: {
  action: () => Promise<unknown>;
  /** The account's words (D312 A11). */
  words: PlatformMessages["deleteReminder"];
}) {
  return (
    <div className="border-t border-line pt-4">
      <ConfirmButton kind="none" question={words.question} confirm={words.delete} action={action} busy={words.deleting} className="text-sm text-danger-text underline disabled:opacity-50">
        {words.delete}
      </ConfirmButton>
    </div>
  );
}
