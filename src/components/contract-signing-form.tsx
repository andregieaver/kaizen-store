"use client";

import { useActionState, useState, useTransition } from "react";

import type { SigningText } from "@/lib/contract-signing-text";

/**
 * What a contract's signer does on their page (D695 step 3): ask for a code to their email, then type it with their full name, agree and
 * sign; or decline, with a reason if they like. One main action at a time: the code first, then Sign. Words in the contract's language.
 */

type State = { status: "idle" | "code_sent" | "error"; problem?: string };
/** The page's words a client part can carry: strings only (the server writes the sentences with a name in them). */
export type SigningFormWords = Pick<SigningText["page"], "step1" | "sendCode" | "codeLabel" | "nameLabel" | "agree" | "sign" | "decline" | "declineReason" | "declineSend" | "problems"> & {
  heading: string;
  codeSent: string;
};
type Words = SigningFormWords;

const field = "min-h-11 w-full rounded-md border border-current/25 bg-transparent px-3 text-base";

export function ContractSigningForm({
  words: w,
  defaultName,
  requestCode,
  sign,
  decline,
}: {
  words: Words;
  defaultName: string;
  requestCode: () => Promise<State>;
  sign: (state: State, form: FormData) => Promise<State>;
  decline: (state: State, form: FormData) => Promise<State>;
}) {
  const [asked, setAsked] = useState<State>({ status: "idle" });
  const [asking, start] = useTransition();
  const [signState, signAction, signing] = useActionState(sign, { status: "idle" } as State);
  const [declineState, declineAction, declining] = useActionState(decline, { status: "idle" } as State);
  const [declineOpen, setDeclineOpen] = useState(false);
  const problemText = (key: string | undefined) => (key && key in w.problems ? w.problems[key as keyof Words["problems"]] : null);
  const codeSent = asked.status === "code_sent" || signState.status === "code_sent";
  const ask = () => start(async () => setAsked(await requestCode()));

  return (
    <section aria-label={w.heading} className="flex flex-col gap-4 rounded-lg border border-current/15 p-5">
      <h2 className="font-heading text-xl">{w.heading}</h2>
      {!codeSent ? (
        <div className="flex flex-col gap-3">
          <p>{w.step1}</p>
          <div>
            <button type="button" onClick={ask} disabled={asking} className="button-primary inline-flex min-h-11 items-center px-5 text-sm font-medium">
              {w.sendCode}
            </button>
          </div>
        </div>
      ) : (
        <form action={signAction} className="flex flex-col gap-3">
          <p role="status">{w.codeSent}</p>
          <label className="flex flex-col gap-1 text-sm font-medium">
            {w.codeLabel}
            <input name="code" inputMode="numeric" autoComplete="one-time-code" maxLength={7} required className={`${field} tracking-[0.3em]`} />
          </label>
          <label className="flex flex-col gap-1 text-sm font-medium">
            {w.nameLabel}
            <input name="name" defaultValue={defaultName} autoComplete="name" required maxLength={200} className={field} />
          </label>
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" name="agree" required className="mt-1" />
            {w.agree}
          </label>
          <div className="flex flex-wrap items-center gap-3">
            <button type="submit" disabled={signing} className="button-primary inline-flex min-h-11 items-center px-6 text-sm font-medium">
              {w.sign}
            </button>
            <button type="button" onClick={ask} disabled={asking} className="text-sm underline">
              {w.sendCode}
            </button>
          </div>
        </form>
      )}
      {(problemText(asked.problem) || problemText(signState.problem)) && (
        <p role="alert" className="text-sm font-medium text-red-700">
          {problemText(signState.problem) ?? problemText(asked.problem)}
        </p>
      )}

      <div className="border-t border-current/15 pt-4">
        {!declineOpen ? (
          <button type="button" onClick={() => setDeclineOpen(true)} className="text-sm underline">
            {w.decline}
          </button>
        ) : (
          <form action={declineAction} className="flex flex-col gap-3">
            <label className="flex flex-col gap-1 text-sm font-medium">
              {w.declineReason}
              <textarea name="reason" maxLength={500} className={`${field} min-h-20 py-2`} />
            </label>
            <div>
              <button type="submit" disabled={declining} className="inline-flex min-h-11 items-center rounded-md border border-current/30 px-5 text-sm font-medium">
                {w.declineSend}
              </button>
            </div>
            {problemText(declineState.problem) && (
              <p role="alert" className="text-sm font-medium text-red-700">
                {problemText(declineState.problem)}
              </p>
            )}
          </form>
        )}
      </div>
    </section>
  );
}
