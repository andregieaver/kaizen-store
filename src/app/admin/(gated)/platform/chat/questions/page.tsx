import type { Metadata } from "next";

import { PageHeader } from "@/components/admin/ui";
import { UnansweredQuestionsView } from "@/components/admin/unanswered-questions-view";
import { adminLangOf } from "@/lib/admin-lang";
import { adminText } from "@/lib/admin-text";
import { QUESTION_STATUSES, type QuestionStatus } from "@/lib/unanswered-questions";
import { platformCan, requirePlatform } from "@/server/auth";
import { listUnanswered, savedAnswers } from "@/server/unanswered-questions";

import { answerPlatformQuestionAction, dismissPlatformQuestionAction, restorePlatformQuestionAction } from "./actions";

export const metadata: Metadata = { title: "Questions Kaizena Flow's assistant couldn't answer" };

/**
 * The questions Kaizena Flow's own chat assistant could not answer (ecosystem plan E4.3, D729): on its site, on its desk for owners and in
 * its chats on other websites, the rows without a store. Visitors' words, so the support area reads them (D510); those who may change it
 * answer them into Kaizena Flow's knowledge base. The docs guide's questions are on Docs feedback (D444).
 */
export default async function PlatformQuestionsPage({ searchParams }: PageProps<"/admin/platform/chat/questions">) {
  const account = await requirePlatform("support", "read");
  const lang = adminLangOf(account.adminLocale);
  const words = adminText(lang, "support");
  const asked = (await searchParams).show;
  const show: QuestionStatus = typeof asked === "string" && (QUESTION_STATUSES as readonly string[]).includes(asked) ? (asked as QuestionStatus) : "open";
  const rows = await listUnanswered(null, show);
  const answers = show === "open" ? await savedAnswers(null, rows) : new Map<string, { title: string; content: string }>();
  const write = platformCan(account, "support");
  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <PageHeader back={{ href: "/admin/platform/chat", label: words.questions.back }} title={words.pages.platformQuestions.title} description={words.questions.description} />
      <UnansweredQuestionsView
        rows={rows}
        show={show}
        base="/admin/platform/chat/questions"
        inbox="/admin/platform/support"
        knowledge="/admin/platform/chat"
        answers={answers}
        answer={write ? (id) => answerPlatformQuestionAction.bind(null, id) : null}
        dismiss={write ? (id) => dismissPlatformQuestionAction.bind(null, id) : null}
        restore={write ? (id) => restorePlatformQuestionAction.bind(null, id) : null}
        lang={lang}
        words={words}
      />
    </div>
  );
}
