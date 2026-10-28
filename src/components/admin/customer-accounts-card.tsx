"use client";

import { useState, useTransition } from "react";

import type { AccountsMode } from "@/lib/customer-accounts";

import { useAdminText } from "./admin-text";
import { Button, Card } from "./ui";

type Answer = { ok: true } | { ok: false; problems: string[] };
type AsyncAnswer = Promise<Answer>;
type Save = (mode: AccountsMode) => AsyncAnswer;

/** Settings → Checkout: whether shoppers can, must or cannot have an account (D365). */
export function CustomerAccountsCard({ mode, canWrite, save }: { mode: AccountsMode; canWrite: boolean; save: Save }) {
  const w = useAdminText("shipping").customerAccounts;
  const [chosen, setChosen] = useState<AccountsMode>(mode);
  const [pending, start] = useTransition();
  const [said, setSaid] = useState<{ ok: boolean; lines: string[] } | null>(null);
  const options: { value: AccountsMode; label: string; hint: string }[] = [
    { value: "optional", label: w.optional, hint: w.optionalHint },
    { value: "required", label: w.required, hint: w.requiredHint },
    { value: "off", label: w.off, hint: w.offHint },
  ];
  return (
    <Card title={w.title} description={w.description}>
      <form
        aria-busy={pending}
        className="flex flex-col gap-3"
        action={() =>
          start(async () => {
            const answer = await save(chosen);
            setSaid(answer.ok ? { ok: true, lines: [w.saved] } : { ok: false, lines: answer.problems });
          })
        }
      >
        <fieldset className="flex flex-col gap-2" disabled={!canWrite}>
          <legend className="sr-only">{w.title}</legend>
          {options.map((o) => (
            <label key={o.value} className="flex items-start gap-2 text-sm">
              <input type="radio" name="mode" value={o.value} checked={chosen === o.value} onChange={() => setChosen(o.value)} className="mt-0.5 size-4" />
              <span>
                {o.label}
                <span className="block text-muted">{o.hint}</span>
              </span>
            </label>
          ))}
        </fieldset>
        {canWrite && (
          <div className="flex flex-wrap items-center gap-3">
            <Button type="submit" disabled={pending || chosen === mode}>
              {w.save}
            </Button>
            {said && (
              <div role={said.ok ? "status" : "alert"} className={`text-sm ${said.ok ? "text-positive-text" : "text-danger-text"}`}>
                {said.lines.map((line) => (
                  <p key={line}>{line}</p>
                ))}
              </div>
            )}
          </div>
        )}
      </form>
    </Card>
  );
}
