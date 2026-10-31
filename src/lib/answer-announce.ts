/**
 * What a screen reader is told of the AI manager's conversation (PSI ACC-08, ACC-03): only an answer once it is finished, and only one it
 * has not been told, never the words as they stream in nor the answers already there when a conversation opens. Pure.
 */

type Said = { id: string; role: string; content: string };

/** The newest answer to say, or null: the last message when it is the assistant's, finished (not streaming) and not the one said last. */
export function answerToAnnounce(messages: readonly Said[], saidId: string | null, streaming: boolean): { id: string; text: string } | null {
  if (streaming) return null;
  const last = messages.at(-1);
  if (!last || last.role !== "assistant" || last.id === saidId || last.id === "streaming") return null;
  const text = last.content.trim();
  return text ? { id: last.id, text } : null;
}

/** The answer already in place when a conversation is opened: it counts as said, so opening one reads nothing out. */
export const alreadySaid = (messages: readonly Said[]): string | null => messages.findLast((m) => m.role === "assistant")?.id ?? null;
