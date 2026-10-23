import type { Metadata } from "next";

import { ChatAgentView } from "@/components/admin/chat-agent-view";
import { requirePlatformAdmin } from "@/server/auth";
import { uploadsEnabled } from "@/server/media";
import { adminLangOf } from "@/lib/admin-lang";

import { uploadPlatformImageAction } from "../actions";
import { addPlatformDocumentAction, deletePlatformDocumentAction, savePlatformChatAgentAction } from "./actions";

export const metadata: Metadata = { title: "Chat agent" };

/** Kaizen's own chat agent and its knowledge base (D81). */
export default async function PlatformChatPage() {
  const account = await requirePlatformAdmin();
  return (
    <ChatAgentView
      storeId={null}
      siteName="Kaizena Flow"
      locales={["en-GB"]}
      aiPage="/admin/platform/ai"
      save={savePlatformChatAgentAction}
      upload={uploadsEnabled() ? uploadPlatformImageAction : null}
      addDocument={addPlatformDocumentAction}
      deleteDocument={deletePlatformDocumentAction}
      lang={adminLangOf(account.adminLocale)}
    />
  );
}
