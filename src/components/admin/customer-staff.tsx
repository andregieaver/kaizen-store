import { ActionForm, SubmitButton, type FormState } from "@/components/admin/action-form";
import { Card } from "@/components/admin/ui";
import { fillWords } from "@/lib/admin-fill";
import type { CustomersMessages } from "@/lib/admin-messages/customers.en";
import { CUSTOMER_COMPANY_MAX, CUSTOMER_NAME_MAX, CUSTOMER_NOTE_MAX, CUSTOMER_PHONE_MAX } from "@/lib/customer-staff";

/**
 * Staff's own forms on a customer (wave 10 unit C, D366): the details form for adding and editing (one set of fields, the server checks
 * everything again with `cleanCustomerInput()`), and the notes card. Presentational: the page passes the bound actions and its words.
 */

type Staff = CustomersMessages["staff"];

export type CustomerFormValues = {
  email: string;
  name: string;
  phone: string;
  line1: string;
  line2: string;
  postalCode: string;
  city: string;
  country: string;
  companyName: string;
  organisationNumber: string;
};

export const EMPTY_CUSTOMER_FORM: CustomerFormValues = { email: "", name: "", phone: "", line1: "", line2: "", postalCode: "", city: "", country: "", companyName: "", organisationNumber: "" };

const field = "min-h-10 rounded-md border border-line bg-card px-3 font-normal";
const labelClass = "flex flex-col gap-1 text-sm font-medium";

/** The details of a customer: email, name and phone, then the address and the company, each whole or empty. */
export function CustomerForm({
  action,
  values,
  words,
  submit,
  note,
}: {
  action: (state: FormState, form: FormData) => Promise<FormState>;
  values: CustomerFormValues;
  words: Staff["form"];
  submit: string;
  note?: string;
}) {
  const input = (name: keyof CustomerFormValues, label: string, opts: { type?: string; max: number; required?: boolean; auto?: string; hint?: string }) => (
    <label className={labelClass}>
      {label}
      <input name={name} type={opts.type ?? "text"} defaultValue={values[name]} maxLength={opts.max} required={opts.required} autoComplete={opts.auto ?? "off"} className={field} />
      {opts.hint && <span className="text-xs font-normal text-muted">{opts.hint}</span>}
    </label>
  );
  return (
    <ActionForm action={action} className="flex flex-col gap-4" successMessage={words.saved}>
      <div className="grid gap-3 sm:grid-cols-2">
        {input("email", words.email, { type: "email", max: 254, required: true })}
        {input("name", words.name, { max: CUSTOMER_NAME_MAX })}
        {input("phone", words.phone, { type: "tel", max: CUSTOMER_PHONE_MAX })}
      </div>
      <fieldset className="flex flex-col gap-3">
        <legend className="mb-2 text-body-strong text-ink">{words.address}</legend>
        <div className="grid gap-3 sm:grid-cols-2">
          {input("line1", words.line1, { max: 200 })}
          {input("line2", words.line2, { max: 200 })}
          {input("postalCode", words.postalCode, { max: 20 })}
          {input("city", words.city, { max: 100 })}
          {input("country", words.country, { max: 2, hint: words.countryHint })}
        </div>
      </fieldset>
      <fieldset className="flex flex-col gap-3">
        <legend className="mb-2 text-body-strong text-ink">{words.company}</legend>
        <div className="grid gap-3 sm:grid-cols-2">
          {input("companyName", words.companyName, { max: CUSTOMER_COMPANY_MAX })}
          {input("organisationNumber", words.organisationNumber, { max: 40 })}
        </div>
        <p className="text-xs text-muted">{words.companyHint}</p>
      </fieldset>
      {note && <p className="text-xs text-muted">{note}</p>}
      <div>
        <SubmitButton>{submit}</SubmitButton>
      </div>
    </ActionForm>
  );
}

export type NoteView = { id: string; body: string; createdAt: string; author: string | null };

/** The notes staff keep on a person, newest first, with who wrote each and when; adding and deleting for those who may change customers. */
export function CustomerNotes({
  notes,
  words,
  add,
  remove,
  date,
}: {
  notes: NoteView[];
  words: Staff["notes"];
  add: ((state: FormState, form: FormData) => Promise<FormState>) | null;
  remove: ((noteId: string) => () => Promise<void>) | null;
  date: (iso: string) => string;
}) {
  return (
    <Card title={words.title} description={words.only} compact>
      {add && (
        <ActionForm action={add} className="mb-4 flex flex-col gap-2" successMessage="">
          <label className={labelClass}>
            <span className="sr-only">{words.label}</span>
            <textarea name="note" required maxLength={CUSTOMER_NOTE_MAX} rows={3} placeholder={words.placeholder} className="rounded-md border border-line bg-card p-3 font-normal" />
          </label>
          <div>
            <SubmitButton variant="secondary">{words.add}</SubmitButton>
          </div>
        </ActionForm>
      )}
      {notes.length === 0 ? (
        <p className="text-sm text-muted">{words.none}</p>
      ) : (
        <ul className="flex flex-col divide-y divide-line text-sm">
          {notes.map((n) => (
            <li key={n.id} className="flex flex-col gap-1 py-3 first:pt-0 last:pb-0">
              <p className="whitespace-pre-wrap break-words">{n.body}</p>
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted">
                <span>{n.author ? fillWords(words.by, { author: n.author, date: date(n.createdAt) }) : fillWords(words.byUnknown, { date: date(n.createdAt) })}</span>
                {remove && (
                  <form action={remove(n.id)}>
                    <button type="submit" aria-label={fillWords(words.deleteLabel, { date: date(n.createdAt) })} className="rounded-pill px-2 underline">
                      {words.delete}
                    </button>
                  </form>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
