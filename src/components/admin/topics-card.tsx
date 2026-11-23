"use client";

import { useState, useTransition } from "react";

import { TOPIC_LINE_MAX, TOPIC_NAME_MAX, topicName, type Topic, type TopicNames } from "@/lib/marketing-topics";

import type { MarketingMessages } from "@/lib/admin-messages/marketing.en";

import { Button, CARD_CLASS, EmptyState } from "./ui";
import { Field, TextInput } from "./ui/field";

type Problem = { ok: false; problem: string };

export type TopicRow = Topic & { readers: number };

type Props = {
  storeSlug: string;
  /** The store's languages, main first, by name in the admin's language. */
  locales: { code: string; name: string }[];
  topics: TopicRow[];
  canWrite: boolean;
  numbers: string;
  /** The card's words, handed by the page: only this group of the marketing area reaches the browser. */
  words: MarketingMessages["topics"];
  /** One action for every change (a save, an archive or a move), so the topics add one server reference, not three. */
  act: (storeSlug: string, change: TopicChange) => Promise<Problem | { ok: true }>;
};

export type TopicChange =
  | { op: "save"; id: string | null; input: unknown }
  | { op: "archive"; id: string; archived: boolean }
  | { op: "move"; id: string; by: -1 | 1 };

/**
 * A store's email topics on the subscriber list (email plan M4.2, D882): each by its name, how many readers it reaches now and whether it
 * is on unless turned off; *Add a topic* opens a name per language (the main one first) and the one choice. Archived topics stay listed
 * under the others, to bring back.
 */
export function TopicsCard(props: Props) {
  const w = props.words;
  const [editing, setEditing] = useState<string | "new" | null>(null);
  const [busy, start] = useTransition();
  const main = props.locales[0]?.code ?? "en-GB";
  const live = props.topics.filter((t) => !t.archived);
  const archived = props.topics.filter((t) => t.archived);
  return (
    <section aria-labelledby="topics" className={`flex flex-col gap-3 px-6 py-4 ${CARD_CLASS}`} data-topics>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="topics" className="text-title text-ink">
          {w.title}
        </h2>
        {props.canWrite && editing === null && live.length < 20 && (
          <Button size="dense" onClick={() => setEditing("new")}>
            {w.add}
          </Button>
        )}
      </div>
      {live.length === 0 ? <EmptyState compact title={w.none} /> : <p className="text-body text-ink-2">{w.lead}</p>}
      {editing === "new" && <TopicForm {...props} topic={null} onDone={() => setEditing(null)} />}
      {live.length > 0 && (
        <ul className="divide-y divide-line">
          {live.map((t, i) =>
            editing === t.id ? (
              <li key={t.id} className="py-3">
                <TopicForm {...props} topic={t} onDone={() => setEditing(null)} />
              </li>
            ) : (
              <li key={t.id} className="flex min-h-14 flex-wrap items-center justify-between gap-3 py-3">
                <span className="flex min-w-0 flex-col">
                  <span className="text-body text-ink">{topicName(t.names, main, main).name}</span>
                  <span className="text-caption text-ink-2">
                    {w.reaches.replace("{n}", t.readers.toLocaleString(props.numbers))} · {t.defaultOn ? w.onByDefault : w.offByDefault}
                  </span>
                </span>
                {props.canWrite && (
                  <span className="flex flex-wrap gap-1">
                    <Button size="dense" kind="quiet" disabled={busy || i === 0} onClick={() => start(async () => void (await props.act(props.storeSlug, { op: "move", id: t.id, by: -1 })))}>
                      {w.up}
                    </Button>
                    <Button size="dense" kind="quiet" disabled={busy || i === live.length - 1} onClick={() => start(async () => void (await props.act(props.storeSlug, { op: "move", id: t.id, by: 1 })))}>
                      {w.down}
                    </Button>
                    <Button size="dense" kind="quiet" onClick={() => setEditing(t.id)}>
                      {w.rename}
                    </Button>
                    <Button size="dense" kind="quiet" disabled={busy} onClick={() => start(async () => void (await props.act(props.storeSlug, { op: "archive", id: t.id, archived: true })))}>
                      {w.archive}
                    </Button>
                  </span>
                )}
              </li>
            ),
          )}
        </ul>
      )}
      {archived.length > 0 && (
        <details>
          <summary className="cursor-pointer text-caption text-ink-2">
            {w.archived} ({archived.length})
          </summary>
          <ul className="mt-2 flex flex-col gap-2">
            {archived.map((t) => (
              <li key={t.id} className="flex flex-wrap items-center justify-between gap-2 text-body text-ink-2">
                {topicName(t.names, main, main).name}
                {props.canWrite && (
                  <Button size="dense" kind="quiet" disabled={busy} onClick={() => start(async () => void (await props.act(props.storeSlug, { op: "archive", id: t.id, archived: false })))}>
                    {w.restore}
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}

/** A topic's name and line in each of the store's languages, and whether readers get it unless they turn it off. */
function TopicForm({ storeSlug, locales, act, words: w, topic, onDone }: Props & { topic: Topic | null; onDone: () => void }) {
  const [names, setNames] = useState<TopicNames>(topic?.names ?? {});
  const [defaultOn, setDefaultOn] = useState(topic?.defaultOn ?? true);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, start] = useTransition();
  const set = (code: string, part: "name" | "line", value: string) =>
    setNames({ ...names, [code]: { name: names[code]?.name ?? "", line: names[code]?.line ?? "", [part]: value } });
  const submit = () =>
    start(async () => {
      const result = await act(storeSlug, { op: "save", id: topic?.id ?? null, input: { names, defaultOn } });
      if (!result.ok) return setProblem(result.problem);
      onDone();
    });
  return (
    <div className="flex flex-col gap-3 rounded-md border border-line p-3" data-topic-form>
      {locales.map((l, i) => (
        <div key={l.code} className="grid gap-2 sm:grid-cols-2">
          <Field label={locales.length > 1 ? w.nameIn.replace("{language}", l.name) : w.name} required={i === 0}>
            {(control) => <TextInput {...control} value={names[l.code]?.name ?? ""} maxLength={TOPIC_NAME_MAX} onChange={(e) => set(l.code, "name", e.target.value)} />}
          </Field>
          <Field label={w.line}>
            {(control) => <TextInput {...control} value={names[l.code]?.line ?? ""} maxLength={TOPIC_LINE_MAX} onChange={(e) => set(l.code, "line", e.target.value)} />}
          </Field>
        </div>
      ))}
      <label className="flex items-center gap-2 text-body text-ink">
        <input type="checkbox" checked={defaultOn} onChange={(e) => setDefaultOn(e.target.checked)} />
        {w.defaultOn}
      </label>
      {problem && (
        <p role="alert" className="text-caption text-danger-text">
          {problem}
        </p>
      )}
      <div className="flex gap-2">
        <Button size="dense" kind="main" disabled={busy} onClick={submit}>
          {w.save}
        </Button>
        <Button size="dense" kind="quiet" onClick={onDone}>
          {w.cancel}
        </Button>
      </div>
    </div>
  );
}
