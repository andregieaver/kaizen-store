import type { ReactNode } from "react";

import { Button, EmptyState, Field, Select } from "@/components/admin/ui";

import { InsightsFrame } from "./social-insights-card";

/**
 * The forms every connected social account's card has on Social posts (D870: Facebook S1.2b, Pinterest S3.4), each a plain form posted to
 * the card's route (`src/server/social-connect-routes.ts`): one button, connecting (or why it cannot be), choosing among the person's Pages
 * or boards, and how the last try went.
 */

export function ActionForm({ action, what, label, kind = "secondary" }: { action: string; what: string; label: string; kind?: "main" | "secondary" | "quiet" }) {
  return (
    <form method="post" action={action}>
      <input type="hidden" name="do" value={what} />
      <Button type="submit" kind={kind}>
        {label}
      </Button>
    </form>
  );
}

/** *Connect*, for a member who may; otherwise who can, or that the platform's app is not set up here. */
export function ConnectAction({ action, mayConnect, appOn, words }: { action: string; mayConnect: boolean; appOn: boolean; words: { connect: string; askOwner: string; off: string } }) {
  if (!mayConnect) return <p className="text-caption text-ink-2">{words.askOwner}</p>;
  return appOn ? <ActionForm action={action} what="connect" label={words.connect} /> : <p className="text-caption text-ink-2">{words.off}</p>;
}

/** Choosing among the person's Pages or boards (`field`: the form's name for the choice). */
export function ChooseForm({ action, field, label, keep, choices }: { action: string; field: string; label: string; keep: string; choices: readonly { id: string; name: string }[] }) {
  return (
    <form method="post" action={action} className="flex flex-wrap items-end gap-3">
      <input type="hidden" name="do" value="choose" />
      <Field label={label}>
        {(control) => (
          <Select name={field} {...control}>
            {choices.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        )}
      </Field>
      <Button type="submit" kind="main">
        {keep}
      </Button>
    </form>
  );
}

/** How the last connect or choice went, in the card's words; `bad` when it did not work. */
export function DoneNote({ said, bad }: { said: string | null; bad: boolean }) {
  if (!said) return null;
  return (
    <p role="status" className={bad ? "text-body text-danger-text" : "text-body text-ink"}>
      {said}
    </p>
  );
}

type FrameWords = { title: string; lead: string; none: string; connect: string; askOwner: string; off: string; disconnect: string; done: Record<string, string> };

/**
 * A connected account's whole card (Pinterest, TikTok, LinkedIn): how the last try went, *Connect* while there is none, the choice among the
 * person's places where there is one, the card's own words once connected (`children`), and connecting again or disconnecting.
 */
export function ConnectionCard({
  id,
  words: w,
  state,
  choose,
  action,
  mayConnect,
  appOn,
  done,
  bad = ["failed"],
  children,
}: {
  id: string;
  words: FrameWords;
  state: "none" | "choose" | "ready";
  /** The places to choose among, and the form's name and words for the choice. */
  choose?: { field: string; label: string; keep: string; choices: readonly { id: string; name: string }[] };
  action: string;
  mayConnect: boolean;
  /** The platform's app is set up here. */
  appOn: boolean;
  /** How the last connect or choice went, from the address. */
  done: string | null;
  /** The statuses that say it did not work. */
  bad?: readonly string[];
  children?: ReactNode;
}) {
  const said = done && Object.hasOwn(w.done, done) ? w.done[done] : null;
  return (
    <InsightsFrame id={id} title={w.title} lead={w.lead}>
      <DoneNote said={said} bad={Boolean(done && bad.includes(done))} />
      {state === "none" && <EmptyState compact title={w.none} action={<ConnectAction action={action} mayConnect={mayConnect} appOn={appOn} words={w} />} />}
      {state === "choose" && choose && (mayConnect ? <ChooseForm action={action} {...choose} /> : <p className="text-caption text-ink-2">{w.askOwner}</p>)}
      {state === "ready" && children}
      {state !== "none" && mayConnect && (
        <div className="flex flex-wrap gap-2">
          {appOn && <ActionForm action={action} what="connect" label={w.connect} kind="quiet" />}
          <ActionForm action={action} what="disconnect" label={w.disconnect} kind="quiet" />
        </div>
      )}
    </InsightsFrame>
  );
}
