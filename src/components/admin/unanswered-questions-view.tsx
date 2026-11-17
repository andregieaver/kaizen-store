import Link from "next/link";

import { ActionForm, SubmitButton, type FormState } from "@/components/admin/action-form";
import { buttonClass } from "@/components/admin/ui";
import { countWords, fillWords } from "@/lib/admin-fill";
import { ADMIN_LANG_FACTS, type AdminLang } from "@/lib/admin-lang";
import type { SupportMessages } from "@/lib/admin-messages/support.en";
import { ANSWER_MAX, answerTitle, type QuestionStatus, type UnansweredQuestion } from "@/lib/unanswered-questions";
import { DOCUMENT_TITLE_MAX } from "@/lib/knowledge";

type Action = (state: FormState, form: FormData) => Promise<FormState>;

const field = "min-h-10 w-full rounded-md border border-line bg-card px-3 py-2";
const SHOWS: QuestionStatus[] = ["open", "answered", "dismissed"];

/**
 * The questions the chat assistant could not answer (ecosystem plan E4.3, D729), for a store or Kaizena Flow: the most asked first, each
 * with one clear action, *Write the answer*, which saves a short knowledge document the assistant uses next time, and a quiet *Not a
 * question for the assistant*. Homer sees the question, how often it was asked and the button. Lisa opens *Customise* for the document's
 * title, *Details* for the language, why it counted and the conversations it came from, and the other tabs for what was answered or set
 * aside (with *Put it back*). The visitor's words are drawn as text, never as HTML.
 */
export function UnansweredQuestionsView({
  rows,
  show,
  base,
  inbox,
  knowledge,
  answers,
  answer,
  dismiss,
  restore,
  lang,
  words,
}: {
  rows: UnansweredQuestion[];
  show: QuestionStatus;
  /** This page's address. */
  base: string;
  /** The desk's inbox, where `?c=` opens a conversation. */
  inbox: string;
  /** The chat assistant's page, with the knowledge base. */
  knowledge: string;
  /** The answers saved before, by document id: the form starts from them. */
  answers: Map<string, { title: string; content: string }>;
  /** The bound actions, or null for someone who may only read. */
  answer: ((id: string) => Action) | null;
  dismiss: ((id: string) => Action) | null;
  restore: ((id: string) => Action) | null;
  lang: AdminLang;
  words: SupportMessages;
}) {
  const w = words.questions;
  const locale = ADMIN_LANG_FACTS[lang].locale;
  const date = (iso: string) => new Date(iso).toLocaleDateString(locale, { day: "numeric", month: "short", year: "numeric" });
  const languageName = (code: string) => {
    try {
      return new Intl.DisplayNames([locale], { type: "language" }).of(code) ?? code;
    } catch {
      return code;
    }
  };
  const tabs: Record<QuestionStatus, string> = { open: w.open, answered: w.answered, dismissed: w.dismissed };
  const none: Record<QuestionStatus, string> = { open: w.noneOpen, answered: w.noneAnswered, dismissed: w.noneDismissed };

  return (
    <div className="flex flex-col gap-4">
      <nav aria-label={w.nav} className="flex flex-wrap gap-2 text-sm">
        {SHOWS.map((s) => (
          <Link
            key={s}
            href={s === "open" ? base : `${base}?show=${s}`}
            aria-current={show === s ? "page" : undefined}
            className={`rounded-panel px-3 py-1.5 ${show === s ? "bg-sunken font-medium" : ""}`}
          >
            {tabs[s]}
          </Link>
        ))}
      </nav>
      {rows.length === 0 ? (
        <p className="text-muted">{none[show]}</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {rows.map((row) => {
            const saved = row.documentId ? answers.get(row.documentId) : undefined;
            const knowledgeOnly = row.asked - row.handedOver;
            return (
              <li key={row.id} className="flex flex-col gap-3 rounded-panel bg-sunken p-4">
                <div className="flex flex-col gap-1">
                  {/* The visitor's words, kept cut and masked: text, never HTML. */}
                  <p className="text-body-strong text-ink" lang={row.lang}>
                    “{row.question}”
                  </p>
                  <p className="text-sm text-muted">
                    {countWords(row.asked, w.asked)} · {fillWords(w.lastAsked, { date: date(row.lastAt) })}
                  </p>
                </div>

                {show === "open" && saved && <p className="text-sm text-ink-2">{w.answeredBefore}</p>}

                {show === "open" && answer && (
                  <details className="group" open={rows.length === 1 || undefined}>
                    <summary className={`${buttonClass("strong")} w-fit cursor-pointer list-none [&::-webkit-details-marker]:hidden`}>{w.write}</summary>
                    <ActionForm action={answer(row.id)} className="mt-3 flex flex-col gap-3" successMessage={w.saved} replaceOnSuccess>
                      <label className="flex flex-col gap-1">
                        <span className="text-sm">{w.answerLabel}</span>
                        <textarea name="answer" required rows={4} maxLength={ANSWER_MAX} defaultValue={saved?.content ?? ""} className={field} />
                      </label>
                      <p className="text-sm text-muted">{w.answerHint}</p>
                      <details>
                        <summary className="cursor-pointer text-sm text-ink-2">{w.customise}</summary>
                        <label className="mt-2 flex flex-col gap-1">
                          <span className="text-sm">{w.titleLabel}</span>
                          <input name="title" maxLength={DOCUMENT_TITLE_MAX} defaultValue={saved?.title ?? answerTitle(row.question)} className={field} />
                        </label>
                        <p className="mt-1 text-sm text-muted">{w.titleHint}</p>
                      </details>
                      <div>
                        <SubmitButton>{w.save}</SubmitButton>
                      </div>
                    </ActionForm>
                  </details>
                )}

                {show === "open" && dismiss && (
                  <ActionForm action={dismiss(row.id)} successMessage={w.dismissedDone} replaceOnSuccess>
                    <SubmitButton skipValidation className={buttonClass("quiet")}>
                      {w.notForAssistant}
                    </SubmitButton>
                  </ActionForm>
                )}

                {show === "answered" && (
                  <p className="text-sm">
                    <Link href={knowledge} className="underline">
                      {w.inKnowledge}
                    </Link>
                  </p>
                )}

                {show === "dismissed" && restore && (
                  <ActionForm action={restore(row.id)} successMessage={w.putBackDone} replaceOnSuccess>
                    <SubmitButton variant="secondary" skipValidation>
                      {w.putBack}
                    </SubmitButton>
                  </ActionForm>
                )}

                <details>
                  <summary className="cursor-pointer text-sm text-ink-2">{w.details}</summary>
                  <div className="mt-2 flex flex-col gap-1 text-sm">
                    <p>{fillWords(w.language, { lang: languageName(row.lang) })}</p>
                    {row.handedOver > 0 && <p>{countWords(row.handedOver, w.handedOver)}</p>}
                    {knowledgeOnly > 0 && <p>{w.foundNothing}</p>}
                    <p>{fillWords(w.firstAsked, { date: date(row.firstAt) })}</p>
                    <p className="mt-1 text-ink-2">{w.conversations}</p>
                    {row.conversations.length === 0 ? (
                      <p className="text-muted">{w.noConversations}</p>
                    ) : (
                      <ul className="flex flex-col gap-1">
                        {row.conversations.map((c) => (
                          <li key={c.id}>
                            <Link href={`${inbox}?c=${c.id}`} className="underline">
                              {fillWords(w.openConversation, { date: date(c.at) })}
                            </Link>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </details>
              </li>
            );
          })}
        </ul>
      )}
      <p className="text-caption text-muted">{w.kept}</p>
    </div>
  );
}
