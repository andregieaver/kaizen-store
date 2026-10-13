import { t } from "@/lib/i18n";

import type { SupportThreadLabels } from "./support-thread";

/** The thread's words in a language (D216): the chat's own. */
export function threadLabels(lang: string): SupportThreadLabels {
  const c = t(lang).chat;
  return {
    you: c.thread.you,
    aiAssistant: c.aiAssistant,
    placeholder: c.placeholder,
    send: c.send,
    sorry: c.sorry,
    ended: c.thread.ended,
    lines: {
      ended: c.lines.ended,
      reopened: c.lines.reopened,
      queued: c.lines.queued,
      joined: c.lines.joined("{name}"),
      left: c.lines.left("{name}"),
      assistantBack: c.lines.assistantBack,
    },
  };
}
