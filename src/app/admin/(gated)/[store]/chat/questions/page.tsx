import type { Metadata } from "next";

import { PageHeader } from "@/components/admin/ui";
import { UnansweredQuestionsView } from "@/components/admin/unanswered-questions-view";
import { adminLangOf } from "@/lib/admin-lang";
import { QUESTION_STATUSES, type QuestionStatus } from "@/lib/unanswered-questions";
import { SUPPORT_WORDS } from "@/lib/admin-words/support";
import { memberCan, requirePermission } from "@/server/permissions";
import { listUnanswered, savedAnswers } from "@/server/unanswered-questions";

import { answerQuestionAction, dismissQuestionAction, restoreQuestionAction } from "./actions";

export const metadata: Metadata = { title: "Questions your assistant couldn't answer" };

/**
 * The questions the store's chat assistant could not answer (ecosystem plan E4.3, D729), beside its knowledge base: the most asked first,
 * each answered once into the knowledge base or set aside. `support:read` to read, `support:write` to answer.
 */
export default async function StoreQuestionsPage({ params, searchParams }: PageProps<"/admin/[store]/chat/questions">) {
  const { store: slug } = await params;
  const member = await requirePermission(slug, "support:read");
  const lang = adminLangOf(member.account.adminLocale);
  const words = SUPPORT_WORDS[lang];
  const asked = (await searchParams).show;
  const show: QuestionStatus = typeof asked === "string" && (QUESTION_STATUSES as readonly string[]).includes(asked) ? (asked as QuestionStatus) : "open";
  const rows = await listUnanswered(member.store.id, show);
  const answers = show === "open" ? await savedAnswers(member.store.id, rows) : new Map<string, { title: string; content: string }>();
  const write = memberCan(member, "support:write");
  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <PageHeader back={{ href: `/admin/${slug}/chat`, label: words.questions.back }} title={words.pages.storeQuestions.title} description={words.questions.description} />
      <UnansweredQuestionsView
        rows={rows}
        show={show}
        base={`/admin/${slug}/chat/questions`}
        inbox={`/admin/${slug}/support`}
        knowledge={`/admin/${slug}/chat`}
        answers={answers}
        answer={write ? (id) => answerQuestionAction.bind(null, slug, id) : null}
        dismiss={write ? (id) => dismissQuestionAction.bind(null, slug, id) : null}
        restore={write ? (id) => restoreQuestionAction.bind(null, slug, id) : null}
        lang={lang}
        words={words}
        timeZone={member.store.timeZone}
      />
    </div>
  );
}
