"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useId, useState, useTransition } from "react";

import { fillWords } from "@/lib/admin-fill";

import { useAdminText } from "./admin-text";
import { RecoveryCodesView } from "./recovery-codes-view";
import { CARD_CLASS } from "@/components/admin/ui";

/** What starting an enrolment gives back: the QR code (an SVG as a data address), the secret to type by hand and the factor to finish. */
export type EnrolStarted = { ok: true; factorId: string; qrCode: string; secret: string; uri: string } | { ok: false; problem: string };
export type EnrolFinished = { ok: true; codes: string[] } | { ok: false; problem: string; locked?: boolean };

const button = "min-h-10 rounded-pill border border-edge bg-card px-4 text-sm font-medium hover:bg-sunken disabled:opacity-40";
const primary = "min-h-10 rounded-pill bg-brand px-4 text-sm font-medium text-brand-ink disabled:opacity-40";
const field = "min-h-10 rounded-md border border-line bg-card px-3 font-normal";

/** The secret in groups of four, so it can be typed by hand without losing the place. */
export const groupedSecret = (secret: string): string => secret.replace(/\s+/g, "").replace(/(.{4})/g, "$1 ").trim();

/**
 * Setting up two-step sign-in (wave 1, 1f, `docs/wave-1-trust.md` 2.6): start, scan or type the secret, type the first code, save the ten
 * recovery codes, go on. Nothing is made on the server until the person presses the first button, so opening the page changes nothing.
 * Going on is a full page load to `nextHref`, so the session that was just promoted is the one the next page reads.
 */
export function EnrolPanel({
  start,
  finish,
  account,
  madeOn,
  nextHref,
  why,
  alreadyOn = false,
}: {
  /** Two-step sign-in is already on and passed in this session: said, unless this panel is the one that just turned it on (then the codes are still being shown). */
  alreadyOn?: boolean;
  start: () => Promise<EnrolStarted>;
  finish: (factorId: string, code: string) => Promise<EnrolFinished>;
  account: string;
  madeOn: string;
  /** Where the person goes once they have saved the codes. */
  nextHref: string;
  /** Why they are here, when something requires it: shown above the first step. */
  why?: string;
}) {
  const id = useId();
  const w = useAdminText("signIn").enrol;
  const [pending, run] = useTransition();
  const [started, setStarted] = useState<Extract<EnrolStarted, { ok: true }> | null>(null);
  const [codes, setCodes] = useState<string[] | null>(null);
  const [problem, setProblem] = useState("");
  const [code, setCode] = useState("");

  if (!codes && !started && alreadyOn) {
    return (
      <div className="flex flex-col gap-3 text-sm">
        <p>{w.alreadyOn}</p>
        <div>
          <Link href={nextHref} className={`${primary} inline-flex items-center`}>
            {w.continue}
          </Link>
        </div>
      </div>
    );
  }
  if (codes) return <RecoveryCodesView codes={codes} account={account} madeOn={madeOn} continueLabel={w.continue} onContinue={() => window.location.assign(nextHref)} />;

  return (
    <div className="flex flex-col gap-4">
      {why && <p className={`p-3 text-sm ${CARD_CLASS}`}>{why}</p>}
      {!started ? (
        <div className="flex flex-col gap-3 text-sm">
          <p className="text-muted">{w.intro}</p>
          <div>
            <button
              type="button"
              disabled={pending}
              className={primary}
              onClick={() =>
                run(async () => {
                  setProblem("");
                  const result = await start();
                  if (result.ok) setStarted(result);
                  else setProblem(result.problem);
                })
              }
            >
              {pending ? w.working : w.start}
            </button>
          </div>
        </div>
      ) : (
        <form
          className="flex flex-col gap-4 text-sm"
          onSubmit={(event) => {
            event.preventDefault();
            run(async () => {
              setProblem("");
              const result = await finish(started.factorId, code);
              if (result.ok) setCodes(result.codes);
              else setProblem(result.problem);
            });
          }}
        >
          <ol className="flex list-decimal flex-col gap-3 pl-5">
            <li>
              {w.scan}
              {/* The QR code is an SVG from the Auth server, drawn as a picture so nothing in it runs. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={started.qrCode} alt={w.qrAlt} width={176} height={176} className="mt-2 rounded-md border border-line bg-white p-2" />
            </li>
            <li>
              {w.byHand}
              <code className="mt-1 block w-fit rounded-md border border-line bg-card px-2 py-1 font-mono break-all">{groupedSecret(started.secret)}</code>
            </li>
            <li>
              <label htmlFor={`${id}-code`} className="font-medium">
                {w.typeCode}
              </label>
              <input
                id={`${id}-code`}
                name="code"
                value={code}
                onChange={(event) => setCode(event.target.value)}
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="[0-9 ]*"
                maxLength={7}
                required
                className={`${field} mt-1 block w-40 text-lg tracking-widest tabular-nums`}
              />
            </li>
          </ol>
          <div>
            <button type="submit" disabled={pending || code.replace(/\s/g, "").length < 6} className={primary}>
              {pending ? w.checking : w.turnOn}
            </button>
          </div>
        </form>
      )}
      <p role="alert" className="min-h-5 text-sm text-danger-text">
        {problem}
      </p>
    </div>
  );
}

/**
 * Two-step sign-in on Your account: where it stands, new recovery codes, and switching it off. Both changes need a session that has passed
 * the second step (Supabase's rule for a verified factor), which the server checks and answers in words.
 */
export function ManageTwoStep({
  enrolled,
  codesLeft,
  platformAdmin,
  recoveryAvailable,
  setUpHref,
  account,
  madeOn,
  regenerate,
  remove,
}: {
  enrolled: boolean;
  codesLeft: number;
  platformAdmin: boolean;
  recoveryAvailable: boolean;
  setUpHref: string;
  account: string;
  madeOn: string;
  regenerate: () => Promise<EnrolFinished>;
  remove: () => Promise<{ ok: true } | { ok: false; problem: string }>;
}) {
  const router = useRouter();
  const w = useAdminText("signIn").manage;
  const [pending, run] = useTransition();
  const [codes, setCodes] = useState<string[] | null>(null);
  const [problem, setProblem] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [done, setDone] = useState("");

  if (codes) {
    return (
      <RecoveryCodesView
        codes={codes}
        account={account}
        madeOn={madeOn}
        continueLabel={w.done}
        onContinue={() => {
          setCodes(null);
          router.refresh();
        }}
      />
    );
  }
  if (done) return <p role="status" className="rounded-panel border border-line bg-card p-3 text-sm">{done}</p>;
  if (!enrolled) {
    return (
      <div className="flex flex-col gap-3 text-sm">
        <p className="text-muted">
          {w.off} {platformAdmin ? w.offPlatform : w.offStore}
        </p>
        <div>
          <Link href={setUpHref} className={`${primary} inline-flex items-center`}>
            {w.setUp}
          </Link>
        </div>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-3 text-sm">
      <p>
        <strong className="font-medium">{w.on}</strong> {w.onText}{" "}
        {codesLeft === 0 ? w.noCodesLeft : codesLeft === 1 ? w.oneCodeLeft : fillWords(w.codesLeft, { count: codesLeft })}
      </p>
      {!recoveryAvailable && <p className="text-muted">{w.noRecovery}</p>}
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={pending || !recoveryAvailable}
          className={button}
          onClick={() =>
            run(async () => {
              setProblem("");
              const result = await regenerate();
              if (result.ok) setCodes(result.codes);
              else setProblem(result.problem);
            })
          }
        >
          {w.newCodes}
        </button>
        {!platformAdmin && !confirming && (
          <button type="button" className={button} onClick={() => setConfirming(true)}>
            {w.switchOff}
          </button>
        )}
      </div>
      <p className="text-muted">
        {w.endsOld}
        {platformAdmin ? ` ${w.platformCannot}` : ""}
      </p>
      {confirming && (
        <div className={`flex flex-col gap-2 p-3 ${CARD_CLASS}`}>
          <p>{w.confirm}</p>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={pending}
              className={primary}
              onClick={() =>
                run(async () => {
                  setProblem("");
                  const result = await remove();
                  if (result.ok) {
                    setDone(w.switchedOff);
                    router.refresh();
                  } else setProblem(result.problem);
                  setConfirming(false);
                })
              }
            >
              {pending ? w.working : w.yesOff}
            </button>
            <button type="button" className={button} onClick={() => setConfirming(false)}>
              {w.keepOn}
            </button>
          </div>
        </div>
      )}
      <p role="alert" className="min-h-5 text-danger-text">
        {problem}
      </p>
    </div>
  );
}
