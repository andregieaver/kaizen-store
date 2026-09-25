"use client";

import { useTransition } from "react";

/** Deletes a cart reminder after asking; carts already reminded keep their history. */
export function DeleteReminderButton({ action }: { action: () => Promise<unknown> }) {
  const [pending, start] = useTransition();
  return (
    <div className="border-t border-border pt-4">
      <button
        type="button"
        disabled={pending}
        onClick={() => {
          if (window.confirm("Delete this reminder? Carts waiting for it get the next one instead.")) start(async () => void (await action()));
        }}
        className="text-sm text-red-700 underline disabled:opacity-50"
      >
        {pending ? "Deleting …" : "Delete this reminder"}
      </button>
    </div>
  );
}
