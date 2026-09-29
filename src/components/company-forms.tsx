"use client";

import { useActionState, type ReactNode } from "react";

import type { InviteState } from "@/app/s/[store]/[market]/account/company/actions";
import { inviteEmployeesAction } from "@/app/s/[store]/[market]/account/company/actions";
import { acceptInviteAction, type AcceptState } from "@/app/s/[store]/[market]/account/company/invite/[token]/actions";

const input = "min-h-11 w-full rounded-md border border-border bg-background px-3";
const secondary = "min-h-11 rounded-button border border-border px-5 disabled:opacity-40";

/** The company's main account invites employees: one or more addresses. */
export function InviteForm({ store, market, labels }: { store: string; market: string; labels: { label: string; button: string; sending: string } }) {
  const [state, action, pending] = useActionState(inviteEmployeesAction.bind(null, store, market), { ok: false, message: null } as InviteState);
  return (
    <form action={action} className="flex flex-col gap-3">
      <label className="flex flex-col gap-1 text-sm font-medium">
        {labels.label}
        <textarea name="emails" rows={3} required spellCheck={false} autoCapitalize="none" placeholder="anna@example.com, ola@example.com" className={`${input} py-2 font-normal`} />
      </label>
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" disabled={pending} className={secondary}>
          {pending ? labels.sending : labels.button}
        </button>
        <p role="status" aria-live="polite" className={`text-sm empty:hidden ${state.ok ? "" : "text-red-700 dark:text-red-400"}`}>
          {state.message}
        </p>
      </div>
    </form>
  );
}

/** A button in a form that asks first. The action is a bound server action. */
export function ConfirmForm({ action, confirm, className, children }: { action: () => Promise<void>; confirm?: string; className?: string; children: ReactNode }) {
  return (
    <form
      action={action}
      onSubmit={(event) => {
        if (confirm && !window.confirm(confirm)) event.preventDefault();
      }}
    >
      <button type="submit" className={className ?? "text-sm underline"}>
        {children}
      </button>
    </form>
  );
}

/** The button on an invitation's page, and what follows once it is accepted. */
export function AcceptForm({
  store,
  market,
  token,
  email,
  labels,
}: {
  store: string;
  market: string;
  token: string;
  email: string;
  labels: { accept: string; accepting: string; title: string; already: string; existing: string; created: string };
}) {
  const [state, action, pending] = useActionState(acceptInviteAction.bind(null, store, market, token), { done: false, message: null, email, existing: false, already: false } as AcceptState);
  if (state.done) {
    return (
      <div role="status" className="flex flex-col gap-2 rounded-lg border border-border p-4">
        <p className="font-medium">{labels.title}</p>
        <p className="text-sm">{state.already ? labels.already : state.existing ? labels.existing : labels.created}</p>
      </div>
    );
  }
  return (
    <form action={action} className="flex flex-col gap-3">
      <div>
        <button type="submit" disabled={pending} className="button-primary min-h-11 rounded-button px-6 disabled:opacity-40">
          {pending ? labels.accepting : labels.accept}
        </button>
      </div>
      <p role="alert" className="text-sm text-red-700 empty:hidden dark:text-red-400">
        {state.message}
      </p>
    </form>
  );
}
