"use client";

import { useState, useTransition } from "react";

import { CONTACT_MODES, type CheckoutContactSettings, type ContactMode } from "@/lib/checkout-contact";

import { useAdminText } from "./admin-text";
import { Button, Card } from "./ui";

type Answer = { ok: true } | { ok: false; problems: string[] };
type Save = (settings: CheckoutContactSettings) => Promise<Answer>;

const FIELD = "min-h-10 rounded-md border border-line bg-card px-3 text-sm";

/**
 * Settings → Checkout rules: the phone and a person's name the checkout asks besides the email (D357), each not asked (the default), optional
 * or required. Homer sees two choices in words and one Save; where each is asked, and what Stripe's own page and Mollie do, is said under them.
 */
export function ContactFieldsCard({ settings, canWrite, save }: { settings: CheckoutContactSettings; canWrite: boolean; save: Save }) {
  const w = useAdminText("shipping").contactFields;
  const [chosen, setChosen] = useState<CheckoutContactSettings>(settings);
  const [pending, start] = useTransition();
  const [said, setSaid] = useState<{ ok: boolean; lines: string[] } | null>(null);
  const changed = chosen.phone !== settings.phone || chosen.name !== settings.name;
  const rows: { key: keyof CheckoutContactSettings; label: string; hint: string }[] = [
    { key: "phone", label: w.phone, hint: w.phoneHint },
    { key: "name", label: w.name, hint: w.nameHint },
  ];
  return (
    <Card title={w.title} description={w.description}>
      <form
        aria-busy={pending}
        className="flex flex-col gap-4"
        action={() =>
          start(async () => {
            const answer = await save(chosen);
            setSaid(answer.ok ? { ok: true, lines: [w.saved] } : { ok: false, lines: answer.problems });
          })
        }
      >
        <fieldset className="flex flex-col gap-3" disabled={!canWrite}>
          <legend className="sr-only">{w.title}</legend>
          {rows.map((row) => (
            <div key={row.key} className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1">
              <label htmlFor={`contact-${row.key}`} className="min-w-0 flex-1 text-sm">
                <span className="font-medium">{row.label}</span>
                <span className="block text-muted">{row.hint}</span>
              </label>
              <select
                id={`contact-${row.key}`}
                value={chosen[row.key]}
                onChange={(e) => {
                  setChosen({ ...chosen, [row.key]: e.target.value as ContactMode });
                  setSaid(null);
                }}
                className={FIELD}
              >
                {CONTACT_MODES.map((mode) => (
                  <option key={mode} value={mode}>
                    {w.modes[mode]}
                  </option>
                ))}
              </select>
            </div>
          ))}
        </fieldset>
        <p className="text-sm text-muted">{w.where}</p>
        {canWrite && (
          <div className="flex flex-wrap items-center gap-3">
            <Button type="submit" disabled={pending || !changed}>
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
