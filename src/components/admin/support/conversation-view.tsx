import { HANDOFF_WORDS, authorWords, handlerWords, systemWords, toneWords } from "@/lib/support-inbox-text";
import type { StaffConversation, StaffMessage } from "@/server/support";

import { ToneDot } from "./tone";

/**
 * A conversation as staff see it (D216, 2.4): the transcript, live, with every author marked — the customer, the AI (and the tools it
 * used), people, system lines, internal notes and the AI partner's help (both staff only, never sent) — and a tone on each customer
 * message. Every text is drawn as text. Taking over and answering come with step 4.
 */
export function ConversationView({ conversation, now }: { conversation: StaffConversation; now: Date }) {
  return (
    <article className="flex min-h-0 flex-1 flex-col" aria-label={`Conversation with ${conversation.who}`}>
      <header className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-border px-4 py-3">
        <h2 className="min-w-0 flex-1 truncate text-base font-semibold">{conversation.who}</h2>
        <span className="rounded-full border border-border px-2 py-0.5 text-xs">{handlerWords({ ...conversation, queuedAt: null }, now)}</span>
        <ToneDot score={conversation.tone} />
        {conversation.handoffReason && conversation.handler !== "ai" && (
          <p className="w-full text-xs text-muted">{HANDOFF_WORDS[conversation.handoffReason] ?? null}</p>
        )}
      </header>
      {conversation.summary && (
        <section className="border-b border-border px-4 py-3 text-sm" aria-label="Summary">
          <p className="font-medium">{conversation.summary.title}</p>
          <p className="text-muted">{conversation.summary.text}</p>
        </section>
      )}
      <ol role="log" aria-live="polite" aria-label="Messages" className="flex flex-1 flex-col gap-3 overflow-y-auto px-4 py-4">
        {conversation.messages.map((message) => (
          <MessageItem key={message.seq} message={message} />
        ))}
      </ol>
    </article>
  );
}

function MessageItem({ message }: { message: StaffMessage }) {
  if (message.author === "system") {
    const words = systemWords(message.kind, message.data);
    if (!words) return null;
    return (
      <li className="text-center text-xs text-muted" data-author="system">
        {words}
      </li>
    );
  }
  const customer = message.author === "customer";
  const staffOnly = message.author === "note" || message.author === "partner";
  const tone = customer ? toneWords(message.tone) : null;
  return (
    <li className={`flex flex-col gap-1 ${customer ? "items-start" : "items-end"}`} data-author={message.author}>
      <span className="text-xs text-muted">
        {authorWords(message.author, message.by)} · <time dateTime={message.at}>{message.at.slice(11, 16)}</time>
      </span>
      <p
        className={`max-w-[85%] rounded-2xl px-3 py-2 whitespace-pre-line ${
          staffOnly ? "border border-dashed border-border bg-background" : customer ? "bg-surface" : "bg-foreground text-background"
        }`}
      >
        {message.body}
      </p>
      {message.tools.length > 0 && <span className="text-xs text-muted">Used: {message.tools.join(", ")}</span>}
      {tone && <ToneDot score={message.tone} />}
    </li>
  );
}

/** Who the conversation is with and where it came from (the right column's Context tab, 2.4; more comes with later steps). */
export function ConversationContext({ conversation }: { conversation: StaffConversation }) {
  const rows: [string, string][] = [
    ["Who", conversation.who],
    ...(conversation.email ? ([["Email", conversation.email]] as [string, string][]) : []),
    ["Signed in", conversation.signedIn ? "Yes" : "No"],
    ["Language", conversation.locale],
    ...(conversation.store ? ([["Store", conversation.store.name]] as [string, string][]) : []),
    ...(conversation.pagePath ? ([["Started on", conversation.pagePath]] as [string, string][]) : []),
    ["Started", conversation.startedAt.slice(0, 16).replace("T", " ")],
    ...(conversation.endedAt ? ([["Ended", conversation.endedAt.slice(0, 16).replace("T", " ")]] as [string, string][]) : []),
    ["From", conversation.source === "admin" ? "The admin" : "The site's chat"],
  ];
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-2 p-4 text-sm">
      {rows.map(([term, value]) => (
        <div key={term} className="contents">
          <dt className="text-muted">{term}</dt>
          <dd className="min-w-0 break-words">{value}</dd>
        </div>
      ))}
    </dl>
  );
}
