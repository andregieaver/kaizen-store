"use client";

import { SubmitButton } from "@/components/admin/action-form";

/** *Start over* in the sandbox's bar (D457): asks first, since the store it leaves is closed. */
export function StartOver({ action, label, confirm }: { action: () => Promise<void>; label: string; confirm: string }) {
  return (
    <form
      action={action}
      onSubmit={(event) => {
        if (!window.confirm(confirm)) event.preventDefault();
      }}
    >
      <SubmitButton variant="secondary">{label}</SubmitButton>
    </form>
  );
}
