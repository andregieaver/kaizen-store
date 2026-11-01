import { ActionForm, SubmitButton, type FormState } from "@/components/admin/action-form";
import { orderEn, type OrderMessages } from "@/lib/admin-messages/order.en";
import { EVIDENCE_FIELDS, fieldMax, keyFields, SHORT_FIELDS, type Evidence, type EvidenceField } from "@/lib/dispute-evidence";

const input = "w-full rounded-md border border-line bg-card px-3 text-sm font-normal";

/**
 * The evidence for one dispute (D417): the fields a bank looks at first for the dispute's reason, then everything else Stripe takes behind one step,
 * each filled from the order and editable. Homer reads, ticks and presses Send; Lisa opens the rest. With `action` null (sent, closed, or a Mollie
 * chargeback) the fields are shown as they stand and nothing can be pressed.
 */
export function DisputeEvidenceForm({
  fields,
  reason,
  action,
  words = orderEn.dispute,
}: {
  fields: Evidence;
  reason: string | null;
  action: ((state: FormState, form: FormData) => Promise<FormState>) | null;
  words?: OrderMessages["dispute"];
}) {
  const first = keyFields(reason);
  const rest = EVIDENCE_FIELDS.filter((f) => !first.includes(f));
  const field = (name: EvidenceField) => {
    const hint = (words.hints as Partial<Record<EvidenceField, string>>)[name];
    const common = { name, defaultValue: fields[name], maxLength: fieldMax(name), readOnly: action === null, "aria-describedby": hint ? `hint-${name}` : undefined };
    return (
      <label key={name} className="flex flex-col gap-1 text-sm font-medium">
        {words.fields[name]}
        {hint && (
          <span id={`hint-${name}`} className="font-normal text-muted">
            {hint}
          </span>
        )}
        {SHORT_FIELDS.has(name) ? (
          <input {...common} className={`${input} min-h-10 max-w-xl`} />
        ) : (
          <textarea {...common} rows={name === "uncategorized_text" ? 12 : 3} className={`${input} py-2`} />
        )}
      </label>
    );
  };
  const body = (
    <>
      <section aria-labelledby="evidence-first" className="flex flex-col gap-4">
        <h2 id="evidence-first" className="text-title text-ink">
          {words.keyFirst}
        </h2>
        {first.map(field)}
      </section>
      <details className="rounded-panel border border-line p-4">
        <summary className="cursor-pointer text-sm">{words.more}</summary>
        <div className="mt-4 flex flex-col gap-4">{rest.map(field)}</div>
      </details>
    </>
  );
  if (!action) return <div className="flex flex-col gap-6">{body}</div>;
  return (
    <ActionForm action={action} className="flex flex-col gap-6">
      {body}
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" name="confirm" value="yes" className="mt-1 size-4" />
        <span>{words.confirm}</span>
      </label>
      <div className="flex flex-wrap gap-2">
        <SubmitButton name="intent" value="send">
          {words.send}
        </SubmitButton>
        <SubmitButton name="intent" value="save" variant="secondary" skipValidation>
          {words.save}
        </SubmitButton>
      </div>
    </ActionForm>
  );
}
