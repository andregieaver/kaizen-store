"use client";

import { useState, useTransition } from "react";

import { fillWords } from "@/lib/admin-fill";

import { useAdminText } from "./admin-text";
import { Button, Card, Chip, List, ListRow, RowDate, RowLead } from "./ui";

type Answer = { ok: true; secret?: string; message?: string } | { ok: false; message: string };
type Async = Promise<Answer>;
/** The address field's placeholder: the scheme every endpoint starts with. */
const HTTPS = "https://";

export type EndpointView = {
  id: string;
  name: string;
  hint: string;
  topics: string[];
  enabled: boolean;
  /** Written for the reader on the server. */
  failingSince: string | null;
  failingOff: boolean;
  deliveries: { id: string; event: string; status: "pending" | "delivered" | "failed"; when: string; problem: string | null }[];
};

export type EndpointActions = {
  add: (form: FormData) => Async;
  update: (id: string, form: FormData) => Async;
  switchOn: (id: string, on: boolean) => Async;
  renew: (id: string) => Async;
  remove: (id: string) => Async;
  test: (id: string) => Async;
  resend: (deliveryId: string) => Async;
};

type Topic = { id: string; label: string; hint: string };

const SIGNAL = { delivered: "positive", pending: "warning", failed: "danger" } as const;

/** A secret shown once (D354), with a copy button; it is gone from the page when the person is done. */
function SecretOnce({ secret, onDone }: { secret: string; onDone: () => void }) {
  const w = useAdminText("notifications").integrations.endpoints;
  const [copied, setCopied] = useState(false);
  return (
    <div role="status" className="flex flex-col gap-2 rounded-panel border border-warning-line bg-warning-soft p-4 text-sm">
      <p className="text-body-strong text-ink">{w.secretTitle}</p>
      <p className="text-ink-2">{w.secretOnce}</p>
      <code className="break-all rounded-panel bg-card px-3 py-2 font-mono text-xs text-ink">{secret}</code>
      <div className="flex gap-2">
        <Button
          onClick={() => {
            void navigator.clipboard?.writeText(secret).then(() => setCopied(true));
          }}
        >
          {copied ? w.copied : w.copy}
        </Button>
        <Button kind="quiet" onClick={onDone}>
          {w.done}
        </Button>
      </div>
    </div>
  );
}

function EndpointFields({ topics, chosen, name = "", hint }: { topics: Topic[]; chosen: ReadonlySet<string>; name?: string; hint?: string }) {
  const w = useAdminText("notifications").integrations.endpoints;
  return (
    <>
      <label className="flex flex-col gap-1 text-sm font-medium">
        {w.name}
        <input name="name" required maxLength={80} defaultValue={name} placeholder={w.namePlaceholder} className="min-h-10 rounded-md border border-line bg-card px-3 font-normal" />
      </label>
      <label className="flex flex-col gap-1 text-sm font-medium">
        {hint ? w.newUrl : w.url}
        <input name="url" type="url" inputMode="url" autoComplete="off" spellCheck={false} required={!hint} placeholder={HTTPS} className="min-h-10 rounded-md border border-line bg-card px-3 font-mono text-sm font-normal" />
        <span className="font-normal text-muted">{hint ? fillWords(w.keepUrl, { hint }) : w.urlHint}</span>
      </label>
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-sm font-medium">{w.topics}</legend>
        <div className="grid gap-2 sm:grid-cols-2">
          {topics.map((topic) => (
            <label key={topic.id} className="flex items-start gap-2 text-sm">
              <input type="checkbox" name="topics" value={topic.id} defaultChecked={chosen.has(topic.id)} className="mt-0.5 size-4" />
              <span>
                {topic.label}
                <span className="block text-xs text-muted">{topic.hint}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>
    </>
  );
}

/** Adds an endpoint and shows its secret once. */
export function AddEndpoint({ topics, defaults, add }: { topics: Topic[]; defaults: string[]; add: EndpointActions["add"] }) {
  const w = useAdminText("notifications").integrations.endpoints;
  const [pending, start] = useTransition();
  const [problem, setProblem] = useState<string | null>(null);
  const [secret, setSecret] = useState<string | null>(null);
  const [key, setKey] = useState(0);
  if (secret) return <SecretOnce secret={secret} onDone={() => setSecret(null)} />;
  return (
    <form
      key={key}
      aria-busy={pending}
      className="flex flex-col gap-4"
      action={(form) =>
        start(async () => {
          const answer = await add(form);
          if (answer.ok) {
            setProblem(null);
            setKey((k) => k + 1);
            if (answer.secret) setSecret(answer.secret);
          } else setProblem(answer.message);
        })
      }
    >
      <EndpointFields topics={topics} chosen={new Set(defaults)} />
      {problem && (
        <p role="alert" className="text-sm text-danger-text">
          {problem}
        </p>
      )}
      <div>
        <Button kind="main" type="submit" disabled={pending}>
          {pending ? w.adding : w.add}
        </Button>
      </div>
    </form>
  );
}

/** One endpoint: its state, its topics, its actions and its log. */
export function EndpointCard({ endpoint, topics, owner, actions }: { endpoint: EndpointView; topics: Topic[]; owner: boolean; actions: EndpointActions }) {
  const all = useAdminText("notifications").integrations;
  const w = all.endpoints;
  const [pending, start] = useTransition();
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [secret, setSecret] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const run = (act: () => Async) =>
    start(async () => {
      const answer = await act();
      if (answer.ok && answer.secret) setSecret(answer.secret);
      setMessage(answer.ok ? (answer.message ? { ok: true, text: answer.message } : null) : { ok: false, text: answer.message });
    });
  const label = (id: string) => topics.find((t) => t.id === id)?.label ?? id;
  const state = endpoint.enabled ? (
    <Chip signal={endpoint.failingSince ? "warning" : "positive"} dot>
      {endpoint.failingSince ? fillWords(w.failingSince, { when: endpoint.failingSince }) : w.on}
    </Chip>
  ) : (
    <Chip signal={endpoint.failingOff ? "danger" : "neutral"} dot>
      {endpoint.failingOff ? w.switchedOff : w.off}
    </Chip>
  );
  return (
    <Card title={endpoint.name} description={endpoint.hint} aside={state} level={3} compact className="flex flex-col gap-4">
      {endpoint.failingOff && !endpoint.enabled && <p className="text-sm text-ink-2">{fillWords(w.offByUs, { days: 3 })}</p>}
      <p className="text-sm text-ink-2">{endpoint.topics.map(label).join(" · ")}</p>
      {secret && <SecretOnce secret={secret} onDone={() => setSecret(null)} />}
      {owner && editing && (
        <form
          aria-busy={pending}
          className="flex flex-col gap-4"
          action={(form) =>
            start(async () => {
              const answer = await actions.update(endpoint.id, form);
              if (answer.ok) setEditing(false);
              setMessage(answer.ok ? null : { ok: false, text: answer.message });
            })
          }
        >
          <EndpointFields topics={topics} chosen={new Set(endpoint.topics)} name={endpoint.name} hint={endpoint.hint} />
          <div className="flex gap-2">
            <Button kind="main" type="submit" disabled={pending}>
              {pending ? w.saving : w.save}
            </Button>
            <Button kind="quiet" onClick={() => setEditing(false)}>
              {w.done}
            </Button>
          </div>
        </form>
      )}
      {owner && !editing && (
        <div className="flex flex-wrap gap-2">
          <Button disabled={pending} onClick={() => run(() => actions.test(endpoint.id))}>
            {pending ? w.testing : w.test}
          </Button>
          <Button disabled={pending} onClick={() => setEditing(true)}>
            {w.edit}
          </Button>
          <Button disabled={pending} onClick={() => run(() => actions.switchOn(endpoint.id, !endpoint.enabled))}>
            {endpoint.enabled ? w.switchOff : w.switchOn}
          </Button>
          <Button disabled={pending} onClick={() => window.confirm(w.renewQuestion) && run(() => actions.renew(endpoint.id))}>
            {w.renew}
          </Button>
          <Button kind="danger" disabled={pending} onClick={() => window.confirm(fillWords(w.removeQuestion, { name: endpoint.name })) && run(() => actions.remove(endpoint.id))}>
            {w.remove}
          </Button>
        </div>
      )}
      {message && (
        <p role={message.ok ? "status" : "alert"} className={`text-sm ${message.ok ? "text-positive-text" : "text-danger-text"}`}>
          {message.text}
        </p>
      )}
      <div className="flex flex-col gap-2">
        <h4 className="text-body-strong text-ink">{w.log}</h4>
        <p className="text-sm text-muted">{w.logHint}</p>
        {endpoint.deliveries.length === 0 ? (
          <p className="text-sm text-muted">{w.nothing}</p>
        ) : (
          <List label={w.log}>
            {endpoint.deliveries.map((d) => (
              <ListRow key={d.id}>
                <RowLead title={d.event === "test" ? w.test : label(d.event)} sub={d.problem ?? undefined} />
                <RowDate>{d.when}</RowDate>
                <Chip signal={SIGNAL[d.status]} dot>
                  {all.provider.statuses[d.status]}
                </Chip>
                {owner && d.status !== "pending" && (
                  <Button size="dense" kind="quiet" disabled={pending} onClick={() => run(() => actions.resend(d.id))}>
                    {w.resend}
                  </Button>
                )}
              </ListRow>
            ))}
          </List>
        )}
      </div>
    </Card>
  );
}
