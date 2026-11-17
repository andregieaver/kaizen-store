import { createElement as h } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { FormState } from "@/components/admin/action-form";
import { supportEn } from "@/lib/admin-messages/support.en";
import { supportNb } from "@/lib/admin-messages/support.nb";
import type { UnansweredQuestion } from "@/lib/unanswered-questions";

import { UnansweredQuestionsView } from "./unanswered-questions-view";

/** What a person reads: comment markers out, entities made plain. */
const html = (element: Parameters<typeof renderToString>[0]) =>
  renderToString(element).replace(/<!-- -->/g, "").replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&");

const question = (over: Partial<UnansweredQuestion> = {}): UnansweredQuestion => ({
  id: "6f1e4c2a-1b2c-4d3e-8f90-123456789abc",
  question: "Do you ship to Iceland?",
  lang: "en",
  asked: 3,
  handedOver: 1,
  status: "open",
  firstAt: "2026-11-01T10:00:00Z",
  lastAt: "2026-11-16T10:00:00Z",
  documentId: null,
  conversations: [{ id: "7a1e4c2a-1b2c-4d3e-8f90-123456789abc", at: "2026-11-16T10:00:00Z" }],
  ...over,
});
const action = async (): Promise<FormState> => ({ status: "ok", messages: [] });
const view = (rows: UnansweredQuestion[], over: Partial<Parameters<typeof UnansweredQuestionsView>[0]> = {}) =>
  html(
    h(UnansweredQuestionsView, {
      rows,
      show: "open",
      base: "/admin/shop/chat/questions",
      inbox: "/admin/shop/support",
      knowledge: "/admin/shop/chat",
      answers: new Map(),
      answer: () => action,
      dismiss: () => action,
      restore: () => action,
      lang: "en",
      words: supportEn,
      ...over,
    }),
  );

describe("the questions the assistant could not answer (ecosystem plan E4.3)", () => {
  it("shows each question with how often it was asked, one clear action, a quiet set-aside, and its conversations under Details", () => {
    const out = view([question()]);
    expect(out).toContain("“Do you ship to Iceland?”");
    expect(out).toContain("Asked 3 times");
    expect(out).toContain(supportEn.questions.write);
    expect(out).toContain(supportEn.questions.notForAssistant);
    expect(out).toContain('name="answer"');
    // The title starts as the question; Lisa changes it under Customise.
    expect(out).toContain('value="Do you ship to Iceland?"');
    expect(out).toContain(supportEn.questions.customise);
    expect(out).toContain('href="/admin/shop/support?c=7a1e4c2a-1b2c-4d3e-8f90-123456789abc"');
    expect(out).toContain("Handed to a person once");
    expect(out).toContain(supportEn.questions.foundNothing);
  });

  it("draws a visitor's words as text, never as HTML", () => {
    const out = renderToString(h(UnansweredQuestionsView, {
      rows: [question({ question: '<img src=x onerror="alert(1)"> hi there' })],
      show: "open",
      base: "/q",
      inbox: "/i",
      knowledge: "/k",
      answers: new Map(),
      answer: null,
      dismiss: null,
      restore: null,
      lang: "en",
      words: supportEn,
    }));
    expect(out).not.toContain("<img");
    expect(out).toContain("&lt;img");
  });

  it("offers no form to someone who may only read, and starts from the answer saved before", () => {
    const readOnly = view([question()], { answer: null, dismiss: null, restore: null });
    expect(readOnly).not.toContain('name="answer"');
    expect(readOnly).not.toContain(supportEn.questions.notForAssistant);

    const again = view([question({ documentId: "8b1e4c2a-1b2c-4d3e-8f90-123456789abc" })], {
      answers: new Map([["8b1e4c2a-1b2c-4d3e-8f90-123456789abc", { title: "Shipping to Iceland", content: "Yes, in five days." }]]),
    });
    expect(again).toContain(supportEn.questions.answeredBefore);
    expect(again).toContain("Yes, in five days.");
    expect(again).toContain('value="Shipping to Iceland"');
  });

  it("says when nothing waits, offers Put it back on the set-aside tab, and reads Norwegian", () => {
    expect(view([])).toContain(supportEn.questions.noneOpen);
    const dismissed = view([question({ status: "dismissed" })], { show: "dismissed" });
    expect(dismissed).toContain(supportEn.questions.putBack);
    expect(dismissed).not.toContain('name="answer"');
    const nb = view([question({ lang: "nb", asked: 1 })], { lang: "nb", words: supportNb });
    expect(nb).toContain("Spurt én gang");
    expect(nb).toContain(supportNb.questions.write);
  });
});
