"use client";

import { useState, useTransition } from "react";

import type { DomainsMessages } from "@/lib/admin-messages/domains.en";
import { fillWords } from "@/lib/admin-fill";
import type { MoveStep } from "@/lib/domain-move";

import { ActionForm, SubmitButton } from "./action-form";
import type { MoveActions, SwitchCheckShape } from "./domain-types";
import { Button, Card, Chip } from "./ui";

type Words = DomainsMessages["move"];
type Said = { ok: boolean; messages: string[] } | null;

const STATE_SIGNAL = { done: "positive", ready: "insight", waiting: "neutral", blocked: "warning", not_needed: "neutral" } as const;

export type MoveView = {
  apex: string;
  steps: MoveStep[];
  exportHref: string;
  /** The zone's state here: kept and live, on its way out (with where to and until when), or not here. */
  zone: { status: "active" | "leaving"; movedTo: string[]; leavingOn: string | null; keptUntil: string | null } | null;
  registeredHere: boolean;
  registeredHereNote: string | null;
  transferStatus: "active" | "expired" | "transferring_out" | "transferred_out" | null;
  movedOn: string | null;
  blockers: string[];
  advice: string[];
  registrantEmail: string | null;
  connected: string[];
};

/**
 * The steps of a move the owner chose (D315 8), each with its state and its own controls: download, check and switch the nameservers (and
 * back), the transfer code (shown once, to this page only), stopping a move, and disconnecting from the store.
 */
export function DomainMoveSteps({ view, words, actions }: { view: MoveView; words: Words; actions: MoveActions }) {
  return (
    <div className="flex flex-col gap-4">
      {view.steps.map((step, i) => (
        <Card
          key={step.key}
          title={`${i + 1}. ${words.steps[step.key]}`}
          aside={
            <Chip signal={STATE_SIGNAL[step.state]} dot>
              {words.states[step.state]}
            </Chip>
          }
        >
          {step.state !== "not_needed" && <StepBody step={step} view={view} words={words} actions={actions} />}
        </Card>
      ))}
    </div>
  );
}

function StepBody({ step, view, words, actions }: { step: MoveStep; view: MoveView; words: Words; actions: MoveActions }) {
  switch (step.key) {
    case "download":
      return (
        <div className="flex flex-col gap-3">
          <p className="text-body text-ink-2">{words.download.intro}</p>
          <div className="flex flex-wrap gap-2">
            <a className="rounded-pill border border-line px-4 py-2 text-body hover:bg-sunken" href={`${view.exportHref}?format=bind`} download>
              {words.download.zone}
            </a>
            <a className="rounded-pill border border-line px-4 py-2 text-body hover:bg-sunken" href={`${view.exportHref}?format=csv`} download>
              {words.download.csv}
            </a>
          </div>
        </div>
      );
    case "check_new_dns":
      return view.zone?.status === "leaving" ? <Leaving view={view} words={words} actions={actions} /> : <NameserverCheck view={view} words={words} actions={actions} />;
    case "switch_dns":
      return view.zone?.status === "leaving" ? null : <p className="text-body text-ink-2">{view.registeredHere ? words.dns.intro : fillWords(words.dns.elsewhereNote, { domain: view.apex })}</p>;
    case "transfer_code":
      return <TransferCode view={view} words={words} actions={actions} />;
    case "transfer_done":
      return (
        <p className="text-body text-ink-2">
          {view.transferStatus === "transferred_out" && view.movedOn
            ? fillWords(words.transfer.moved, { domain: view.apex, date: view.movedOn })
            : view.transferStatus === "transferring_out"
              ? fillWords(words.transfer.advice.already_started, { domain: view.apex })
              : words.transfer.intro}
        </p>
      );
    case "disconnect":
      return <Disconnect view={view} words={words} actions={actions} />;
  }
}

function Message({ said }: { said: Said }) {
  if (!said) return null;
  return (
    <p role="status" className={said.ok ? "text-body text-positive-text" : "text-body text-danger-text"}>
      {said.messages.join(" ")}
    </p>
  );
}

function NameserverCheck({ view, words, actions }: { view: MoveView; words: Words; actions: MoveActions }) {
  const [text, setText] = useState("");
  const [checked, setChecked] = useState<SwitchCheckShape | null>(null);
  const [pending, start] = useTransition();
  return (
    <div className="flex flex-col gap-3">
      <p className="text-body text-ink-2">{words.dns.intro}</p>
      <label className="flex flex-col gap-1 text-sm">
        {words.dns.nameservers}
        <textarea
          rows={3}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setChecked(null);
          }}
          className="min-h-10 w-full rounded-md border border-line bg-card px-3 py-2 font-mono text-sm"
          spellCheck={false}
        />
        <span className="text-caption text-muted">{words.dns.nameserversHint}</span>
      </label>
      <div>
        <Button kind="secondary" disabled={pending || !text.trim()} onClick={() => start(async () => setChecked(await actions.check(text)))}>
          {words.dns.check}
        </Button>
      </div>
      {checked && !checked.ok && <Message said={{ ok: false, messages: checked.problems }} />}
      {checked?.ok && (
        <div className="flex flex-col gap-3 rounded-panel border border-line bg-sunken p-4">
          {checked.ready && <p className="text-body text-positive-text">{words.dns.allThere}</p>}
          {checked.missing.length > 0 && (
            <>
              <p className="text-body text-ink">{words.dns.missing}</p>
              <ul className="font-mono text-caption text-ink-2">
                {checked.missing.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            </>
          )}
          {checked.unanswered.length > 0 && <p className="text-body text-warning-text">{fillWords(words.dns.unanswered, { list: checked.unanswered.join(", ") })}</p>}
          {checked.unanswered.length === 0 && (
            <ActionForm action={actions.switch} className="flex flex-col gap-2">
              <input type="hidden" name="nameservers" value={text} />
              {checked.missing.length > 0 && (
                <label className="flex items-center gap-2 text-body">
                  <input type="checkbox" name="accept" required />
                  {words.dns.accept}
                </label>
              )}
              {!view.registeredHere && <p className="text-caption text-muted">{fillWords(words.dns.elsewhereNote, { domain: view.apex })}</p>}
              <div>
                <SubmitButton>{words.dns.switch}</SubmitButton>
              </div>
            </ActionForm>
          )}
        </div>
      )}
    </div>
  );
}

function Leaving({ view, words, actions }: { view: MoveView; words: Words; actions: MoveActions }) {
  const [said, setSaid] = useState<Said>(null);
  const [pending, start] = useTransition();
  const zone = view.zone!;
  return (
    <div className="flex flex-col gap-3">
      <p className="text-body text-ink-2">
        {fillWords(words.dns.leaving, { nameservers: zone.movedTo.join(", "), date: zone.leavingOn ?? "", until: zone.keptUntil ?? "" })}
      </p>
      <div>
        <Button
          kind="secondary"
          disabled={pending}
          onClick={() =>
            start(async () => {
              const state = await actions.switchBack();
              setSaid({ ok: state.status === "ok", messages: state.messages });
            })
          }
        >
          {words.dns.switchBack}
        </Button>
      </div>
      <Message said={said} />
    </div>
  );
}

function TransferCode({ view, words, actions }: { view: MoveView; words: Words; actions: MoveActions }) {
  const [code, setCode] = useState<string | null>(null);
  const [said, setSaid] = useState<Said>(null);
  const [signIn, setSignIn] = useState(false);
  const [pending, start] = useTransition();
  if (!view.registeredHere) return <p className="text-body text-ink-2">{view.registeredHereNote}</p>;
  return (
    <div className="flex flex-col gap-3">
      <p className="text-body text-ink-2">{words.transfer.intro}</p>
      {view.blockers.length > 0 && (
        <ul className="flex flex-col gap-1 text-body text-warning-text">
          {view.blockers.map((b) => (
            <li key={b}>{b}</li>
          ))}
        </ul>
      )}
      {view.advice.length > 0 && (
        <ul className="flex flex-col gap-1 text-body text-ink-2">
          {view.advice.map((a) => (
            <li key={a}>{a}</li>
          ))}
        </ul>
      )}
      {view.registrantEmail && <p className="text-caption text-muted">{fillWords(words.transfer.email, { email: view.registrantEmail })}</p>}
      {code ? (
        <div className="flex flex-col gap-1 rounded-panel border border-line bg-sunken p-4">
          <span className="text-eyebrow text-muted">{words.transfer.codeIs}</span>
          <code className="select-all break-all font-mono text-body-strong text-ink">{code}</code>
          <span className="text-caption text-muted">{words.transfer.codeNote}</span>
        </div>
      ) : (
        view.blockers.length === 0 &&
        view.transferStatus !== "transferred_out" && (
          <div className="flex flex-wrap gap-2">
            <Button
              kind="strong"
              disabled={pending}
              onClick={() =>
                start(async () => {
                  const answer = await actions.reveal();
                  if (answer.ok) {
                    setCode(answer.code);
                    setSaid(null);
                  } else {
                    setSaid({ ok: false, messages: answer.problems });
                    setSignIn(Boolean(answer.signIn));
                  }
                })
              }
            >
              {words.transfer.reveal}
            </Button>
            {signIn && (
              <Button kind="secondary" disabled={pending} onClick={() => start(() => actions.signInAgain())}>
                {words.transfer.signIn}
              </Button>
            )}
          </div>
        )
      )}
      {view.transferStatus === "transferring_out" && (
        <div>
          <Button
            kind="quiet"
            disabled={pending}
            onClick={() =>
              start(async () => {
                const state = await actions.stay();
                setSaid({ ok: state.status === "ok", messages: state.messages });
              })
            }
          >
            {words.transfer.stay}
          </Button>
        </div>
      )}
      <Message said={said} />
    </div>
  );
}

function Disconnect({ view, words, actions }: { view: MoveView; words: Words; actions: MoveActions }) {
  const [said, setSaid] = useState<Said>(null);
  const [pending, start] = useTransition();
  if (view.connected.length === 0) return <p className="text-body text-ink-2">{words.disconnect.none}</p>;
  return (
    <div className="flex flex-col gap-3">
      <p className="text-body text-ink-2">{fillWords(words.disconnect.intro, { domain: view.connected.join(", ") })}</p>
      <div>
        <Button
          kind="danger"
          disabled={pending}
          onClick={() =>
            start(async () => {
              const state = await actions.disconnect();
              setSaid({ ok: state.status === "ok", messages: state.messages });
            })
          }
        >
          {words.disconnect.button}
        </Button>
      </div>
      <Message said={said} />
    </div>
  );
}
