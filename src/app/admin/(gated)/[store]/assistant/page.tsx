import type { Metadata } from "next";

import { AiManagerPage } from "@/components/admin/ai-manager-page";
import { requireOwnerRole } from "@/server/permissions";
import { assistantAbilities, getConversation, listConversations } from "@/server/owner-assistant";

import {
  assistantHearAction,
  decideApprovalAction,
  deleteConversationAction,
  loadConversationAction,
  rateAnswerAction,
} from "./actions";

export const metadata: Metadata = { title: "AI manager" };

/** The store's AI manager (D94, D103): for owners only. */
export default async function StoreAssistantPage({ params, searchParams }: PageProps<"/admin/[store]/assistant">) {
  const member = await requireOwnerRole((await params).store);
  const { c, tab } = await searchParams;
  const [abilities, conversations, conversation] = await Promise.all([
    assistantAbilities(member.store.id),
    listConversations(member),
    typeof c === "string" ? getConversation(member, c) : null,
  ]);
  const slug = member.store.slug;
  return (
    <AiManagerPage
      area="store"
      base={`/admin/${slug}/assistant`}
      siteName={member.store.name}
      settingsHref={`/admin/${slug}/settings/ai`}
      accountId={member.account.id}
      tab={typeof tab === "string" ? tab : undefined}
      abilities={abilities}
      conversations={conversations}
      conversation={conversation}
      actions={{
        decide: decideApprovalAction.bind(null, slug),
        remove: deleteConversationAction.bind(null, slug),
        load: loadConversationAction.bind(null, slug),
        rate: rateAnswerAction.bind(null, slug),
        hear: abilities.hear ? assistantHearAction.bind(null, slug) : null,
      }}
    />
  );
}
