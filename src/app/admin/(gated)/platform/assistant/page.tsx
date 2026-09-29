import type { Metadata } from "next";

import { AiManagerPage } from "@/components/admin/ai-manager-page";
import { requirePlatformAdmin } from "@/server/auth";
import { assistantAbilities, getConversation, listConversations } from "@/server/owner-assistant";

import {
  decidePlatformApprovalAction,
  deletePlatformConversationAction,
  loadPlatformConversationAction,
  platformHearAction,
  platformSpeakAction,
  ratePlatformAnswerAction,
} from "./actions";

export const metadata: Metadata = { title: "AI manager" };

/** Kaizen's AI manager (D103): for platform admins. */
export default async function PlatformAssistantPage({ searchParams }: PageProps<"/admin/platform/assistant">) {
  const account = await requirePlatformAdmin();
  const principal = { account, store: null };
  const { c, tab } = await searchParams;
  const [abilities, conversations, conversation] = await Promise.all([
    assistantAbilities(null),
    listConversations(principal),
    typeof c === "string" ? getConversation(principal, c) : null,
  ]);
  return (
    <AiManagerPage
      area="platform"
      base="/admin/platform/assistant"
      siteName="Kaizen"
      settingsHref="/admin/platform/ai"
      accountId={account.id}
      tab={typeof tab === "string" ? tab : undefined}
      abilities={abilities}
      conversations={conversations}
      conversation={conversation}
      actions={{
        decide: decidePlatformApprovalAction,
        remove: deletePlatformConversationAction,
        load: loadPlatformConversationAction,
        rate: ratePlatformAnswerAction,
        hear: abilities.hear ? platformHearAction : null,
        speak: abilities.speak ? platformSpeakAction : null,
      }}
    />
  );
}
