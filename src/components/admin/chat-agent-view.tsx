import Link from "next/link";

import { DOCUMENT_TYPES } from "@/lib/knowledge";
import { t } from "@/lib/i18n";
import { pageLanguages } from "@/lib/page-translation";
import { aiFor, canSpeak } from "@/server/ai";
import { getChatAgentForEdit } from "@/server/chat-agent";
import { DOCUMENTS_MAX, knowledgeStatus, listDocuments } from "@/server/knowledge";

import { ActionForm, SubmitButton, type FormState } from "./action-form";
import { ChatAgentForm, type SaveChatAgent } from "./chat-agent-form";
import { DeleteDiscountButton } from "./delete-discount-button";
import type { Upload } from "./image-upload";

const card = "rounded-lg border border-border bg-background p-5";
const field = "min-h-10 w-full rounded-md border border-border bg-background px-3 py-2";

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
}) {
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
    <div className="flex max-w-3xl flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Chat agent</h1>
        <p className="text-sm text-muted">
          {agent?.enabled ? (ready ? `On: ${agent.name} answers visitors on ${siteName}.` : "On, but hidden until the site has an AI text model.") : "Off."}
        </p>
      </div>

      <section aria-labelledby="about" className={card}>
        <h2 id="about" className="mb-1 font-medium">How it works</h2>
        <p className="text-sm">
          Visitors chat with an AI assistant in the corner of every page, in writing or aloud. It answers from the site&apos;s
          published pages and articles{storeId ? ", its products with their prices and stock, shipping" : ""} and the knowledge
          base below, opens pages for the visitor while you talk, and declines anything that is not about {siteName}. Visitors are
          told it is AI. Conversations are kept only in the visitor&apos;s browser tab.
        </p>
        {!ready && <p className="mt-2 text-sm font-medium">The chat needs an AI provider with a text model: {aiLink("choose one on the AI page")}.</p>}
      </section>

      <section aria-labelledby="agent" className={card}>
        <h2 id="agent" className="mb-4 font-medium">The agent</h2>
        <ChatAgentForm
          agent={
            agent
              ? {
                  enabled: agent.enabled,
                  name: agent.name,
                  occupation: agent.occupation,
                  avatar: agent.avatar,
                  greeting: agent.greeting,
                  instructions: agent.instructions,
                  voice: agent.voice,
                  dailyLimit: agent.dailyLimit,
                }
              : { enabled: false, name: "", occupation: "", avatar: null, greeting: {}, instructions: "", voice: false, dailyLimit: 500 }
          }
          languages={languages}
          voiceReady={canSpeak(connection)}
          upload={upload}
          save={save}
        />
      </section>

      <section aria-labelledby="knowledge" className={card}>
        <h2 id="knowledge" className="mb-1 font-medium">Knowledge base</h2>
        <p className="mb-4 text-sm text-muted">
          What the agent should know beyond the site&apos;s pages: delivery and returns in detail, care guides, sizes, opening hours,
          answers to common questions. It reads {status.passages} {status.passages === 1 ? "passage" : "passages"} from{" "}
          {status.pages} {status.pages === 1 ? "page" : "pages"} and {status.documents} {status.documents === 1 ? "document" : "documents"}
          {connection?.space
            ? `; ${status.withMeaning} can be found by meaning (the rest within five minutes).`
            : "; with an embedding model on the AI page it also finds them by meaning."}{" "}
          Pages are read again within five minutes of being published.
        </p>

        {documents.length > 0 && (
          <ul className="mb-5 divide-y divide-border rounded-md border border-border">
            {documents.map((document) => (
              <li key={document.id} className="flex items-center justify-between gap-3 px-3 py-2">
                <div className="min-w-0">
                  <p className="truncate font-medium">{document.title}</p>
                  <p className="text-sm text-muted">
                    {[document.fileName, `${document.chars.toLocaleString("en-GB")} characters`, `${document.passages} ${document.passages === 1 ? "passage" : "passages"}`]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                </div>
                <DeleteDiscountButton
                  compact
                  action={deleteDocument.bind(null, document.id)}
                  code={document.title}
                  question={`Delete “${document.title}” from the knowledge base? The agent stops using it at once.`}
                />
              </li>
            ))}
          </ul>
        )}

        {documents.length < DOCUMENTS_MAX ? (
          <ActionForm action={addDocument} className="flex flex-col gap-3">
            <h3 className="font-medium">Add a document</h3>
            <label className="flex flex-col gap-1">
              <span className="text-sm">Title</span>
              <input name="title" maxLength={200} className={field} placeholder="Returns and exchanges" />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-sm">
                A file ({Object.values(DOCUMENT_TYPES).join(", ")}; up to 4 MB)
              </span>
              <input name="file" type="file" accept=".txt,.md,.pdf,.docx" className="text-sm" />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-sm">Or its text</span>
              <textarea name="content" rows={6} className={field} />
            </label>
            <p className="text-sm text-muted">
              Write only what may be told to anyone: the agent can quote it to visitors. No personal data.
            </p>
            <div>
              <SubmitButton>Add to the knowledge base</SubmitButton>
            </div>
          </ActionForm>
        ) : (
          <p className="text-sm">The knowledge base is full ({DOCUMENTS_MAX} documents). Delete one to add another.</p>
        )}
      </section>
    </div>
  );
}
