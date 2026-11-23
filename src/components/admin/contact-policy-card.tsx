"use client";

import { fillWords } from "@/lib/admin-fill";
import type { ContactPolicy } from "@/lib/contact-policy";
import type { MarketingMessages } from "@/lib/admin-messages/marketing.en";

import { ActionForm, SubmitButton, type FormState } from "./action-form";
import { Card } from "./ui/card";

const FIELD = "min-h-10 w-24 rounded-md border border-line bg-card px-3 text-sm tabular-nums";

/**
 * How often people hear from the store (D764, email plan M1.5): the policy in one sentence for Homer, its three settings one press away under
 * Change. `action` is null for someone who may only read.
 */
export function ContactPolicyCard({
  policy,
  words: w,
  action,
}: {
  policy: ContactPolicy;
  words: MarketingMessages["contactPolicy"];
  action: ((state: FormState, form: FormData) => Promise<FormState>) | null;
}) {
  const quiet = policy.quietHours ? w.quietTail : "";
  const summary =
    policy.spacingHours > 0
      ? fillWords(w.summary, { perWeek: policy.perWeek, hours: policy.spacingHours, quiet })
      : fillWords(w.summaryNoSpacing, { perWeek: policy.perWeek, quiet });
  return (
    <Card title={w.title} compact>
      <div className="flex flex-col gap-3" data-contact-policy>
        <p className="text-body text-ink">{summary}</p>
        <p className="text-sm text-muted">{w.note}</p>
        {action ? (
          <details className="text-sm">
            <summary className="cursor-pointer font-medium">{w.change}</summary>
            <ActionForm action={action} successMessage={w.saved} className="mt-3 flex flex-col gap-3">
              <label className="flex flex-wrap items-center justify-between gap-2">
                {w.perWeek}
                <input name="perWeek" type="number" min={1} max={14} required defaultValue={policy.perWeek} className={FIELD} />
              </label>
              <label className="flex flex-wrap items-center justify-between gap-2">
                {w.spacing}
                <input name="spacingHours" type="number" min={0} max={72} required defaultValue={policy.spacingHours} className={FIELD} />
              </label>
              <label className="flex items-center gap-2">
                <input name="quietHours" type="checkbox" defaultChecked={policy.quietHours} className="size-4" />
                {w.quiet}
              </label>
              <div>
                <SubmitButton>{w.save}</SubmitButton>
              </div>
            </ActionForm>
          </details>
        ) : (
          <p className="text-sm text-muted">{w.readOnly}</p>
        )}
      </div>
    </Card>
  );
}
