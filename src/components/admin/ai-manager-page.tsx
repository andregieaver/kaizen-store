import Link from "next/link";

import { deleteAllMemoriesAction, deleteMemoryAction, setLearningAction, updateMemoryAction } from "@/app/admin/(gated)/memory-actions";
import { learningOn, listMemories } from "@/server/assistant-memory";
import type { Conversation, ConversationSummary } from "@/server/owner-assistant";

import { AiManagerChat, type Abilities, type AiManagerActions } from "./ai-manager";
import { AiMemory } from "./ai-memory";

/**
 * The AI manager's own page (D103), for a store or the platform: the
 * conversations, and what it knows about the person (Memory).
 */
export async function AiManagerPage({
  area,
  base,
  siteName,
  settingsHref,
  accountId,
  tab,
  abilities,
  conversations,
  conversation,
  actions,
}: {
  area: "store" | "platform";
  base: string;
  siteName: string;
  settingsHref: string;
  accountId: string;
  tab: string | undefined;
  abilities: Abilities;
  conversations: ConversationSummary[];
  conversation: Conversation | null;
  actions: AiManagerActions;
}) {
  const memory = tab === "memory";
  const [memories, learning] = memory ? await Promise.all([listMemories(accountId), learningOn(accountId)]) : [[], true];
  const tabClass = (on: boolean) => `rounded-md px-3 py-1.5 text-sm ${on ? "bg-surface font-medium" : "text-muted hover:bg-surface"}`;
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold">AI manager</h1>
        <p className="text-sm text-muted">
          Your guide to the admin and your right hand{area === "store" ? ` for ${siteName}` : " for Kaizen"}. Open it from any page with the AI manager button or ⌘K (Ctrl+K).
        </p>
      </div>
      <nav aria-label="AI manager" className="flex gap-1">
        <Link href={base} className={tabClass(!memory)} aria-current={!memory ? "page" : undefined}>
          Conversations
        </Link>
        <Link href={`${base}?tab=memory`} className={tabClass(memory)} aria-current={memory ? "page" : undefined}>
          Memory
        </Link>
      </nav>
      {memory ? (
        <AiMemory
          memories={memories}
          learning={learning}
          actions={{ update: updateMemoryAction, remove: deleteMemoryAction, removeAll: deleteAllMemoriesAction, setLearning: setLearningAction }}
        />
      ) : (
        <AiManagerChat
          key={conversation?.id ?? "new"}
          area={area}
          base={base}
          siteName={siteName}
          settingsHref={settingsHref}
          abilities={abilities}
          conversations={conversations}
          conversation={conversation}
          actions={actions}
          variant="page"
        />
      )}
    </div>
  );
}
