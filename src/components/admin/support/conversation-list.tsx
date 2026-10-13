import { agoWords, handlerWords } from "@/lib/support-inbox-text";
import type { InboxRow } from "@/server/support";

import { ToneDot } from "./tone";

/**
 * The inbox's list (D216, 2.4): who, the last message's first line, who answers (the AI, waiting and for how long, or the person who
 * has it), the tone, an unread dot and the time. Each row is a button that opens the conversation beside the list.
 */
export function ConversationList({
  rows,
  selected,
  now,
  onOpen,
  empty,
}: {
  rows: InboxRow[];
  selected: string | null;
  now: Date;
  onOpen?: (row: InboxRow) => void;
  empty: string;
}) {
  if (rows.length === 0) return <p className="p-4 text-sm text-muted">{empty}</p>;
  return (
    <ul className="divide-y divide-border" aria-label="Conversations">
      {rows.map((row) => {
        const current = row.id === selected;
        return (
          <li key={row.id}>
            <button
              type="button"
              onClick={() => onOpen?.(row)}
              aria-current={current ? "true" : undefined}
              data-conversation={row.id}
              className={`flex w-full flex-col gap-1 px-4 py-3 text-left hover:bg-surface ${current ? "bg-surface" : ""}`}
            >
              <span className="flex items-center gap-2">
                {row.unread && (
                  <span className="size-2 shrink-0 rounded-full bg-foreground" aria-label="Unread" role="img" />
                )}
                <span className={`min-w-0 flex-1 truncate ${row.unread ? "font-semibold" : "font-medium"}`}>{row.who}</span>
                <span className="shrink-0 text-xs text-muted">{agoWords(row.lastMessageAt, now)}</span>
              </span>
              {row.store && <span className="truncate text-xs text-muted">{row.store.name}</span>}
              <span className="line-clamp-1 text-sm text-muted">{row.summaryTitle ?? (row.preview || "No messages yet")}</span>
              <span className="flex items-center gap-2 text-xs">
                <span className={`rounded-full border border-border px-2 py-0.5 ${row.handler === "queue" && row.status === "open" ? "font-medium" : "text-muted"}`}>
                  {handlerWords(row, now)}
                </span>
                {row.signedIn && <span className="text-muted">Signed in</span>}
                {row.source === "admin" && <span className="text-muted">From the admin</span>}
                <ToneDot score={row.tone} compact />
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
