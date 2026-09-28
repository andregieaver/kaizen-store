import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { OwnerAssistant } from "@/components/admin/owner-assistant";
import { requireMember } from "@/server/auth";
import { assistantAbilities, getConversation, listConversations } from "@/server/owner-assistant";

import { assistantHearAction, assistantSpeakAction, decideApprovalAction, deleteConversationAction } from "./actions";

export const metadata: Metadata = { title: "Assistant" };

/** The store's owner assistant (D94): for owners only. */
export default async function StoreAssistantPage({ params, searchParams }: PageProps<"/admin/[store]/assistant">) {
  const member = await requireMember((await params).store);
  if (member.role !== "owner") notFound();
  const { c } = await searchParams;
  const [abilities, conversations, conversation] = await Promise.all([
    assistantAbilities(member.store.id),
    listConversations(member),
    typeof c === "string" ? getConversation(member, c) : null,
  ]);
  const slug = member.store.slug;
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold">Assistant</h1>
      <OwnerAssistant
        key={conversation?.id ?? "new"}
        storeSlug={slug}
        storeName={member.store.name}
        abilities={abilities}
        conversations={conversations}
        conversation={conversation}
        actions={{
          decide: decideApprovalAction.bind(null, slug),
          remove: deleteConversationAction.bind(null, slug),
          hear: abilities.hear ? assistantHearAction.bind(null, slug) : null,
          speak: abilities.speak ? assistantSpeakAction.bind(null, slug) : null,
        }}
      />
    </div>
  );
}
