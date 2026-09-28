import type { Metadata } from "next";

import { ChatAgentView } from "@/components/admin/chat-agent-view";
import { requireMember } from "@/server/auth";
import { uploadsEnabled } from "@/server/media";

import { addDocumentAction, deleteDocumentAction, saveChatAgentAction, uploadChatAvatarAction } from "./actions";

export const metadata: Metadata = { title: "Chat agent" };

/** The store's chat agent and its knowledge base (D81). */
export default async function StoreChatPage({ params }: PageProps<"/admin/[store]/chat">) {
  const { store: slug } = await params;
  const { store } = await requireMember(slug);
  return (
    <ChatAgentView
      storeId={store.id}
      siteName={store.name}
      locales={store.markets.map((market) => market.locale)}
      aiPage={`/admin/${store.slug}/settings/ai`}
      save={saveChatAgentAction.bind(null, store.slug)}
      upload={uploadsEnabled() ? uploadChatAvatarAction.bind(null, store.slug) : null}
      addDocument={addDocumentAction.bind(null, store.slug)}
      deleteDocument={deleteDocumentAction.bind(null, store.slug)}
    />
  );
}
