import type { Metadata } from "next";

import { ChatAgentView } from "@/components/admin/chat-agent-view";
import { requirePermission } from "@/server/permissions";
import { adminLangOf } from "@/lib/admin-lang";
import { uploadsEnabled } from "@/server/media";

import { addDocumentAction, deleteDocumentAction, saveChatAgentAction, uploadChatAvatarAction } from "./actions";

export const metadata: Metadata = { title: "Chat agent" };

/** The store's chat agent and its knowledge base (D81). */
export default async function StoreChatPage({ params }: PageProps<"/admin/[store]/chat">) {
  const { store: slug } = await params;
  const { store, account } = await requirePermission(slug, "support:read");
  return (
    <ChatAgentView
      storeId={store.id}
      siteName={store.name}
      locales={store.localization.locales}
      aiPage={`/admin/${store.slug}/settings/ai`}
      save={saveChatAgentAction.bind(null, store.slug)}
      upload={uploadsEnabled() ? uploadChatAvatarAction.bind(null, store.slug) : null}
      addDocument={addDocumentAction.bind(null, store.slug)}
      deleteDocument={deleteDocumentAction.bind(null, store.slug)}
      lang={adminLangOf(account.adminLocale)}
    />
  );
}
