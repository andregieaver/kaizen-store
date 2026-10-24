"use client";

import { useState, useTransition, type FormEvent } from "react";

import type { DomainsMessages } from "@/lib/admin-messages/domains.en";

import type { HolderActions, HolderChatMessage as Message, HolderProposalShape as Proposal } from "./domain-types";
import { Button, Card } from "./ui";


/**
 * The holder's assistant on *Your domains* (D317 phase 5): a conversation kept in the tab only, and each DNS change it plans shown with what it
 * does and a Confirm button, which is the only way it is made.
 */
export function HolderAssistant({
  words,
  ask,
  confirm,
}: {
  words: DomainsMessages["assistant"];
} & HolderActions) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [draft, setDraft] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const send = (event: FormEvent) => {
    event.preventDefault();
    const text = draft.trim();
    if (!text) return;
    const history = messages;
    setMessages([...history, { role: "user", content: text }]);
    setDraft("");
    setNotice(null);
    startTransition(async () => {
      const answer = await ask(history, text);
      if (!answer.ok) return setNotice(answer.problem);
      setMessages((now) => [...now, { role: "assistant", content: answer.reply }]);
      setProposals(answer.proposals);
    });
  };

  const accept = (token: string) =>
    startTransition(async () => {
      const result = await confirm(token);
      setNotice(result.messages.join(" "));
      if (result.status === "ok") setProposals((now) => now.filter((p) => p.token !== token));
    });

  return (
    <Card title={words.title} description={words.intro}>
      <div className="flex flex-col gap-3" aria-live="polite">
        {messages.map((m, i) => (
          <p key={i} className={m.role === "user" ? "self-end rounded-panel bg-sunken px-3 py-2 text-body text-ink" : "whitespace-pre-line text-body text-ink-2"}>
            <span className="sr-only">{m.role === "user" ? words.you : words.assistant}: </span>
            {m.content}
          </p>
        ))}
        {proposals.map((p) => (
          <div key={p.token} className="flex flex-col gap-2 rounded-panel border border-line p-3">
            <p className="text-body-strong text-ink">{p.domain}</p>
            <p className="text-body text-ink-2">{p.summary}</p>
            <ul className="font-mono text-caption text-muted">
              {p.lines.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
            {p.touchesEmail && <p className="text-caption text-warning-text">{words.emailWarning}</p>}
            <div>
              <Button kind="strong" type="button" disabled={pending} onClick={() => accept(p.token)}>
                {words.confirm}
              </Button>
            </div>
          </div>
        ))}
        {notice && (
          <p role="status" className="text-body text-ink-2">
            {notice}
          </p>
        )}
        <form onSubmit={send} className="flex flex-col gap-2 sm:flex-row sm:items-end" aria-busy={pending}>
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={words.placeholder}
            rows={2}
            maxLength={2000}
            className="min-h-10 flex-1 rounded-md border border-line bg-card px-3 py-2 text-sm"
            aria-label={words.title}
          />
          <Button kind="secondary" type="submit" disabled={pending || !draft.trim()}>
            {pending ? words.thinking : words.send}
          </Button>
        </form>
      </div>
    </Card>
  );
}
