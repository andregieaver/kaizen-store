"use client";

import { useTransition } from "react";

import type { PlatformMessages } from "@/lib/admin-messages/platform.en";

/** Deletes a cart reminder after asking; carts already reminded keep their history. */
export function DeleteReminderButton({
  action,
  words,
}: {
  action: () => Promise<unknown>;
  /** The account's words (D312 A11). */
  words: PlatformMessages["deleteReminder"];
}) {
  const [pending, start] = useTransition();
  return (
    <div className="border-t border-line pt-4">
      <button
        type="button"
        disabled={pending}
        onClick={() => {
          if (window.confirm(words.question)) start(async () => void (await action()));
        }}
        className="text-sm text-danger-text underline disabled:opacity-50"
      >
        {pending ? words.deleting : words.delete}
      </button>
    </div>
  );
}
