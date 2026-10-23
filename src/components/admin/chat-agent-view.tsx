import Link from "next/link";

import { DOCUMENT_TYPES } from "@/lib/knowledge";
import { t } from "@/lib/i18n";
import { pageLanguages } from "@/lib/page-translation";
import { aiFor, canSpeak } from "@/server/ai";
import { getChatAgentForEdit } from "@/server/chat-agent";
import { DOCUMENTS_MAX, knowledgeStatus, listDocuments } from "@/server/knowledge";
import { PageHeader } from "@/components/admin/ui";
import { countWords, fillWords } from "@/lib/admin-fill";
import { ADMIN_LANG_FACTS, type AdminLang } from "@/lib/admin-lang";
import { adminText, adminTexts } from "@/lib/admin-text";

import { AdminTextScope } from "./admin-text";

import { ActionForm, SubmitButton, type FormState } from "./action-form";
import { ChatAgentForm, type SaveChatAgent } from "./chat-agent-form";
import { DeleteDiscountButton } from "./delete-discount-button";
import type { Upload } from "./image-upload";

const card = "rounded-lg border border-line bg-card p-5";
const field = "min-h-10 w-full rounded-md border border-line bg-card px-3 py-2";

/**
 * The chat agent's admin (D81), for a store (its id) or Kaizen (null): the
 * agent, and the knowledge base it answers from with the site's pages.
 */
export async function ChatAgentView({
  storeId,
  siteName,
  locales,
  aiPage,
  save,
  upload,
  addDocument,
  deleteDocument,
  lang = "en",
}: {
  storeId: string | null;
  siteName: string;
  /** The site's languages, main language first. */
  locales: string[];
  /** Where the site's AI is chosen. */
  aiPage: string | null;
  save: SaveChatAgent;
  upload: Upload | null;
  addDocument: (state: FormState, formData: FormData) => Promise<FormState>;
  deleteDocument: (id: string) => Promise<{ ok: true } | { ok: false; problems: string[] }>;
  /** The reader's admin language (D312). */
  lang?: AdminLang;
}) {
  const w = adminText(lang, "platformTools").chat;
  const locale = ADMIN_LANG_FACTS[lang].locale;
  const [agent, connection, documents, status] = await Promise.all([
    getChatAgentForEdit(storeId),
    aiFor(storeId),
    listDocuments(storeId),
    knowledgeStatus(storeId),
  ]);
  const languages = pageLanguages(locales).map((language) => ({
    ...language,
    greeting: t(language.locale.split("-")[0]).chat.greeting(agent?.name || "Ingrid"),
  }));
  const ready = Boolean(connection?.textModel);
  const aiLink = (text: string) => (aiPage ? <Link href={aiPage} className="underline">{text}</Link> : text);

  return (
    <AdminTextScope texts={adminTexts(lang, ["platformTools"])}>
    <div className="flex max-w-3xl flex-col gap-6">
      <PageHeader
        title={w.title}
        description={<>{agent?.enabled ? (ready ? fillWords(w.onReady, { name: agent.name, site: siteName }) : w.onHidden) : w.off}</>}
      />

      <section aria-labelledby="about" className={card}>
        <h2 id="about" className="mb-1 text-title text-ink">{w.how}</h2>
        <p className="text-sm">{fillWords(w.howText, { store: storeId ? w.howStore : "", site: siteName })}</p>
        {!ready && (
          <p className="mt-2 text-sm font-medium">
            {w.needsAi.split("{link}")[0]}
            {aiLink(w.needsAiLink)}
            {w.needsAi.split("{link}")[1]}
          </p>
        )}
      </section>

      <section aria-labelledby="agent" className={card}>
        <h2 id="agent" className="mb-4 text-title text-ink">{w.agent}</h2>
        <ChatAgentForm
          agent={
            agent
              ? {
                  enabled: agent.enabled,
                  name: agent.name,
                  occupation: agent.occupation,
                  avatar: agent.avatar,
                  avatarStyle: agent.avatarStyle,
                  greeting: agent.greeting,
                  instructions: agent.instructions,
                  voice: agent.voice,
                  dailyLimit: agent.dailyLimit,
                }
              : { enabled: false, name: "", occupation: "", avatar: null, avatarStyle: null, greeting: {}, instructions: "", voice: false, dailyLimit: 500 }
          }
          languages={languages}
          voiceReady={canSpeak(connection)}
          upload={upload}
          save={save}
        />
      </section>

      <section aria-labelledby="knowledge" className={card}>
        <h2 id="knowledge" className="mb-1 text-title text-ink">{w.knowledge}</h2>
        <p className="mb-4 text-sm text-muted">
          {fillWords(w.knowledgeText, {
            passages: countWords(status.passages, w.passage),
            pages: countWords(status.pages, w.page),
            documents: countWords(status.documents, w.document),
          })}
          {connection?.space ? fillWords(w.byMeaning, { n: status.withMeaning }) : w.noMeaning} {w.reread}
        </p>

        {documents.length > 0 && (
          <ul className="mb-5 divide-y divide-line rounded-md border border-line">
            {documents.map((document) => (
              <li key={document.id} className="flex items-center justify-between gap-3 px-3 py-2">
                <div className="min-w-0">
                  <p className="truncate font-medium">{document.title}</p>
                  <p className="text-sm text-muted">
                    {[document.fileName, fillWords(w.characters, { n: document.chars.toLocaleString(locale) }), countWords(document.passages, w.passage)]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                </div>
                <DeleteDiscountButton
                  compact
                  action={deleteDocument.bind(null, document.id)}
                  code={document.title}
                  question={fillWords(w.deleteDocument, { title: document.title })}
                />
              </li>
            ))}
          </ul>
        )}

        {documents.length < DOCUMENTS_MAX ? (
          <ActionForm action={addDocument} className="flex flex-col gap-3">
            <h3 className="text-body-strong text-ink">{w.addDocument}</h3>
            <label className="flex flex-col gap-1">
              <span className="text-sm">{w.docTitle}</span>
              <input name="title" maxLength={200} className={field} placeholder={w.docTitleHint} />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-sm">{fillWords(w.docFile, { types: Object.values(DOCUMENT_TYPES).join(", ") })}</span>
              <input name="file" type="file" accept=".txt,.md,.pdf,.docx" className="text-sm" />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-sm">{w.docText}</span>
              <textarea name="content" rows={6} className={field} />
            </label>
            <p className="text-sm text-muted">{w.docNote}</p>
            <div>
              <SubmitButton>{w.add}</SubmitButton>
            </div>
          </ActionForm>
        ) : (
          <p className="text-sm">{fillWords(w.full, { n: DOCUMENTS_MAX })}</p>
        )}
      </section>
    </div>
    </AdminTextScope>
  );
}
