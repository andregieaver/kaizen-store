import type { Metadata } from "next";

import { ChatAgentView } from "@/components/admin/chat-agent-view";
import { platformCan, requirePlatformReader } from "@/server/auth";
import { uploadsEnabled } from "@/server/media";
import { adminLangOf } from "@/lib/admin-lang";
import { WEBSITE_PICK_WORDS } from "@/lib/admin-words/website-pick";
import { AdminAreas } from "@/components/admin/admin-areas";

import { uploadPlatformImageAction } from "../actions";
import { addPlatformDocumentAction, deletePlatformDocumentAction, savePlatformChatAgentAction } from "./actions";

export const metadata: Metadata = { title: "Chat agent" };

/** Kaizen's own chat agent and its knowledge base (D81). */
export default async function PlatformChatPage() {
  const account = await requirePlatformReader();
  return (
    <AdminAreas areas={{ websitePick: WEBSITE_PICK_WORDS }}>
    <ChatAgentView
      storeId={null}
      siteName="Kaizena Flow"
      locales={["en-GB"]}
      aiPage="/admin/platform/ai"
      save={savePlatformChatAgentAction}
      upload={uploadsEnabled() ? uploadPlatformImageAction : null}
      addDocument={addPlatformDocumentAction}
      deleteDocument={deletePlatformDocumentAction}
      questions={platformCan(account, "support", "read") ? "/admin/platform/chat/questions" : null}
      lang={adminLangOf(account.adminLocale)}
    />
    </AdminAreas>
  );
}
