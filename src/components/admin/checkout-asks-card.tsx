"use client";

import { useState, useTransition } from "react";

import { CONTACT_MODES, type CheckoutContactSettings, type ContactMode } from "@/lib/checkout-contact";
import type { AccountsMode } from "@/lib/customer-accounts";

import { fillWords } from "@/lib/admin-fill";

import { useAdminText } from "./admin-text";
import { openCheckoutQuestion } from "./checkout-rules";
import { Button, CARD_CLASS } from "./ui";

type Answer = { ok: true } | { ok: false; problems: string[] };

const MODES: AccountsMode[] = ["optional", "required", "off"];
const FIELD = "min-h-10 rounded-md border border-line bg-card px-3 text-sm";

/**
 * Settings → Checkout rules, what the checkout asks (round 7, D624): customer accounts (D365) as three choices, the phone and the name (D357)
 * as two selects, one Save for all of them, and beside it a picture of the form a shopper fills in, which follows the choices as they are made.
 * Where each is asked, and what Stripe's own page and Mollie do, is one fold away. The two settings keep their own actions; Save calls the one
 * whose choice changed. Under the form the picture lists the store's own questions (D357), each a link that opens it in the list below
 * (`openCheckoutQuestion()`), or Add a question when there is none, and a link back to these choices.
 */
export function CheckoutAsksCard({
  mode,
  contact,
  canWrite,
  saveMode,
  saveContact,
  questions = [],
}: {
  mode: AccountsMode;
  contact: CheckoutContactSettings;
  canWrite: boolean;
  saveMode: (mode: AccountsMode) => Promise<Answer>;
  saveContact: (settings: CheckoutContactSettings) => Promise<Answer>;
  /** The questions the checkout asks (those switched on), in order, by their words in the store's main language. */
  questions?: { id: string; label: string; required: boolean }[];
}) {
  const shipping = useAdminText("shipping");
  const w = shipping.checkoutAsks;
  const cw = shipping.contactFields;
  const aw = shipping.customerAccounts;
  const [chosenMode, setMode] = useState<AccountsMode>(mode);
  const [chosen, setChosen] = useState<CheckoutContactSettings>(contact);
  const [pending, start] = useTransition();
  const [said, setSaid] = useState<{ ok: boolean; lines: string[] } | null>(null);
  const modeChanged = chosenMode !== mode;
  const contactChanged = chosen.phone !== contact.phone || chosen.name !== contact.name;
  const save = () =>
    start(async () => {
      const problems: string[] = [];
      if (modeChanged) {
        const answer = await saveMode(chosenMode);
        if (!answer.ok) problems.push(...answer.problems);
      }
      if (contactChanged) {
        const answer = await saveContact(chosen);
        if (!answer.ok) problems.push(...answer.problems);
      }
      setSaid(problems.length === 0 ? { ok: true, lines: [w.saved] } : { ok: false, lines: problems });
    });
  const field = (label: string, optional: boolean) => (
    <span className="flex h-10 items-center rounded-md border border-line bg-card px-3 text-caption text-muted">
      {label}
      {optional && <span className="ml-1">{w.optional}</span>}
    </span>
  );

  const preview = (
    <>
        <div aria-hidden className="flex flex-col gap-2 rounded-md border border-line bg-sunken p-3.5">
        {chosenMode === "required" ? (
          <span className="flex h-10 items-center justify-center rounded-md bg-inverse text-caption text-inverse-ink">{w.signInFirst}</span>
        ) : (
          <span className="flex justify-between text-caption text-muted">
            {w.contact}
            {chosenMode === "optional" && <span className="underline">{w.signIn}</span>}
          </span>
        )}
        {field(w.email, false)}
        {chosen.phone !== "off" && field(w.phoneField, chosen.phone === "optional")}
        <span className="mt-1 text-caption text-muted">{w.delivery}</span>
        {field(w.address, false)}
        {field(w.city, false)}
        <span className="text-caption text-muted">{w.follows}</span>
      </div>
      <div className="flex flex-col gap-2">
        <span className="text-caption text-muted">{w.questions}</span>
        {questions.map((q) => (
          <a
            key={q.id}
            href={`#question-${q.id}`}
            onClick={(e) => {
              e.preventDefault();
              openCheckoutQuestion(q.id);
            }}
            aria-label={fillWords(w.editQuestion, { name: q.label })}
            className="flex min-h-10 items-center rounded-md border border-dashed border-edge bg-card px-3 text-caption text-ink hover:bg-sunken"
          >
            <span className="truncate">{q.label}</span>
            {!q.required && <span className="ml-1 shrink-0 text-muted">{w.optional}</span>}
          </a>
        ))}
        {canWrite && (
          <a
            href="#question-new"
            onClick={(e) => {
              e.preventDefault();
              openCheckoutQuestion("new");
            }}
            className="text-sm text-ink underline"
          >
            {w.addQuestion}
          </a>
        )}
      </div>
      <a href="#checkout-asks" className="text-sm text-muted underline">
        {w.changeAsks}
      </a>
    </>
  );

  return (
    <div className="flex flex-wrap items-stretch gap-5">
      <section aria-labelledby="checkout-asks" className={`flex min-w-0 flex-[999_1_440px] flex-col gap-5 p-6 ${CARD_CLASS}`}>
        <h2 id="checkout-asks" className="text-title text-ink">
          {w.title}
        </h2>
        <form
          aria-busy={pending}
          className="flex flex-col gap-5"
          onSubmit={(e) => {
            e.preventDefault();
            save();
          }}
        >
          <fieldset className="grid grid-cols-[repeat(auto-fit,minmax(min(150px,100%),1fr))] gap-2" disabled={!canWrite}>
            <legend className="sr-only">{w.accounts}</legend>
            {MODES.map((m) => (
              <label
                key={m}
                title={aw[`${m}Hint`]}
                className={`flex cursor-pointer flex-col gap-1 rounded-md p-3 text-sm ${chosenMode === m ? "border-2 border-brand" : "border border-line"}`}
              >
                <span className="flex items-center gap-2 text-ink">
                  <input
                    type="radio"
                    name="mode"
                    value={m}
                    checked={chosenMode === m}
                    onChange={() => {
                      setMode(m);
                      setSaid(null);
                    }}
                    className="size-4"
                  />
                  {w.labels[m]}
                </span>
                <span className="text-caption text-muted">{w.shortHints[m]}</span>
              </label>
            ))}
          </fieldset>
          <fieldset className="flex flex-col" disabled={!canWrite}>
            <legend className="sr-only">{cw.title}</legend>
            {(
              [
                ["phone", w.phone],
                ["name", w.name],
              ] as const
            ).map(([key, label]) => (
              <div key={key} className="flex min-h-13 flex-wrap items-center justify-between gap-3 border-b border-line last:border-0">
                <label htmlFor={`contact-${key}`} className="text-sm text-ink">
                  {label}
                </label>
                <select
                  id={`contact-${key}`}
                  value={chosen[key]}
                  onChange={(e) => {
                    setChosen({ ...chosen, [key]: e.target.value as ContactMode });
                    setSaid(null);
                  }}
                  className={FIELD}
                >
                  {CONTACT_MODES.map((m) => (
                    <option key={m} value={m}>
                      {cw.modes[m]}
                    </option>
                  ))}
                </select>
              </div>
            ))}
          </fieldset>
          {canWrite && (
            <div className="flex flex-wrap items-center gap-3">
              <Button type="submit" kind="main" disabled={pending || (!modeChanged && !contactChanged)}>
                {w.save}
              </Button>
              {said ? (
                <div role={said.ok ? "status" : "alert"} className={`text-sm ${said.ok ? "text-positive-text" : "text-danger-text"}`}>
                  {said.lines.map((line) => (
                    <p key={line}>{line}</p>
                  ))}
                </div>
              ) : (
                <span className="text-caption text-muted">{w.always}</span>
              )}
            </div>
          )}
          <details className="text-caption text-muted">
            <summary className="cursor-pointer">{w.more}</summary>
            <p className="mt-2">{cw.phoneHint}</p>
            <p className="mt-1">{cw.nameHint}</p>
            <p className="mt-1">{cw.where}</p>
          </details>
        </form>
      </section>
      <aside aria-labelledby="checkout-preview" className={`hidden min-w-0 flex-[1_1_300px] flex-col gap-3 p-6 sm:flex ${CARD_CLASS}`}>
        <h2 id="checkout-preview" className="text-body-strong text-ink">
          {w.preview}
        </h2>
        {preview}
      </aside>
      {/* Round 24 (D692): on a phone the shopper's view is one press away, not a screen tall below the choices. */}
      <details className={`group w-full sm:hidden ${CARD_CLASS}`}>
        <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-3 px-5 py-3 [&::-webkit-details-marker]:hidden">
          <span className="text-body text-ink">{w.preview}</span>
          <span className="text-sm font-medium text-ink underline underline-offset-2">{w.seeIt}</span>
        </summary>
        <div className="flex flex-col gap-3 px-5 pb-5">{preview}</div>
      </details>
    </div>
  );
}
