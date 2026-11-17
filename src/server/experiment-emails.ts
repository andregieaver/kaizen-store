import "server-only";

import { sql } from "drizzle-orm";
import { z } from "zod";

import { targetLabel } from "@/lib/ab-site";
import { fillWords } from "@/lib/admin-fill";
import { ADMIN_LANG_FACTS, adminLangOf, type AdminLang } from "@/lib/admin-lang";
import { EXPERIMENTS_WORDS } from "@/lib/admin-words/experiments";
import { STAFF_EMAILS_WORDS } from "@/lib/admin-words/staff-emails";
import { renderEmail } from "@/lib/email-layout";
import { answeredEmail, guardrailEmail } from "@/lib/experiment-emails";
import { verdictOf } from "@/lib/experiment-results";
import { GOAL_WORDS } from "@/lib/experiments";
import { partLabelText, targetLabelText } from "@/lib/experiment-words";
import { siteUrl } from "@/lib/site";

import { addNotice } from "./assistant-notices";
import { sendEmail, type SendOutcome } from "./email";
import type { ExperimentInfo } from "./experiment-admin";
import type { ExperimentResults } from "./experiment-results";
import { log } from "./log";
import type { Store } from "./stores";
import { col, typedRows } from "./typed-rows";


/**
 * Tells a store's owners, and whoever made the test, that the guardrail stopped it (D148, phase 6): once to each, whatever
 * runs the check twice. The figures are `experimentResults()`'s own. It never throws: a failure to send changes nothing
 * about the stop, and the platform's view and the test's page show a guardrail stop anyway.
 */
export async function notifyGuardrailStop(
  store: Pick<Store, "id" | "slug" | "name">,
  test: ExperimentInfo,
  results: Pick<ExperimentResults, "harmed" | "funnel" | "days"> & Partial<Pick<ExperimentResults, "harmedBy" | "guardrails">>,
): Promise<SendOutcome[]> {
  try {
    const harmed = results.harmed ? results.funnel[results.harmed] : null;
    const original = results.funnel.a;
    const version = test.variants.find((v) => v.key === results.harmed);
    if (!results.harmed || !harmed || !original || !version) return [];
    const people = await peopleOf(store.id, test.id);
    // What was tested, in the reader's language (D312 A10): English as `targetLabel()` writes it, Norwegian from the experiments catalogue.
    const targetIn = (lang: AdminLang): string => {
      if (lang === "en") {
        const page = targetLabel(test.page.kind, test.page.slug, test.page.title, test.page.role);
        return test.part ? `${test.part.label} on ${page}` : page;
      }
      const words = EXPERIMENTS_WORDS[lang];
      const page = targetLabelText(test.page.kind, test.page.slug, test.page.title, test.page.role, words);
      return test.part ? fillWords(STAFF_EMAILS_WORDS[lang].guardrail.partOn, { part: partLabelText(test.part.label, words), page }) : page;
    };
    const facts = {
      storeName: store.name,
      testName: test.name,
      target: targetIn("en"),
      version: {
        key: version.key,
        name: version.name,
        visitors: harmed.visitors,
        buyers: harmed.buyers,
      },
      original: { visitors: original.visitors, buyers: original.buyers },
      days: results.days,
      url: `${siteUrl()}/admin/${store.slug}/experiments/${test.id}`,
      ...guardrailFigures(results),
    };
    // One email per language, each in the recipient's own admin language (D312 A10).
    const emails = new Map<string, ReturnType<typeof renderEmail>>();
    const emailIn = (stored: unknown) => {
      const lang = adminLangOf(typeof stored === "string" ? stored : null);
      if (!emails.has(lang))
        emails.set(
          lang,
          renderEmail(
            guardrailEmail(facts, STAFF_EMAILS_WORDS[lang], lang),
          ),
        );
      return emails.get(lang)!;
    };
    const outcomes: SendOutcome[] = [];
    for (const person of people) {
      outcomes.push(
        await sendEmail({
          storeId: store.id,
          kind: "experiment.guardrail",
          to: String(person.email),
          email: emailIn(person.admin_locale),
          fromName: "Kaizena Flow",
          idempotencyKey: `experiment.guardrail:${test.id}:${String(person.id)}`,
        }),
      );
    }
    return outcomes;
  } catch (error) {
    log("error", "experiments.guardrail_email_failed", { experimentId: test.id }, error);
    return [];
  }
}

/** For a stop by the speed or the checkout guardrail (D148 phase 19), what that guardrail counted for the version and the original. */
function guardrailFigures(results: Partial<Pick<ExperimentResults, "harmed" | "harmedBy" | "guardrails">>) {
  const kind = results.harmedBy;
  if (kind !== "speed" && kind !== "checkout") return {};
  const check = results.guardrails?.find((g) => g.kind === kind);
  const version = check?.versions.find((v) => v.key === results.harmed);
  const original = check?.versions.find((v) => v.key === "a");
  if (!version || !original) return {};
  return { guardrail: { kind, version: { n: version.n, bad: version.bad }, original: { n: original.n, bad: original.bad } } };
}

const PERSON_ROW = z.object({ id: col.uuid, email: col.text, admin_locale: col.textOrNull });

/** The people a test's news goes to: the store's owners and whoever made the test, each once, with an email address. */
async function peopleOf(storeId: string, testId: string) {
  return typedRows(PERSON_ROW, sql`
    select distinct on (a.id) a.id, a.email, a.admin_locale
    from commerce.store_members m
    join commerce.accounts a on a.id = m.account_id and a.disabled_at is null
    where m.store_id = ${storeId}::uuid and m.disabled_at is null and a.email <> ''
      and (m.role = 'owner' or a.id = (select e.created_by from commerce.experiments e where e.id = ${testId}::uuid and e.store_id = ${storeId}::uuid))
  `);
}

/**
 * Tells a test's owners, and whoever made it, the first time it has an answer (D662): an AI manager notice (D350) and one email each, in
 * their own admin language, with the verdict as the test's page words it. Called once, by the job that marked the test answered
 * (`markAnswered()`). It never throws: the test's page shows the answer anyway.
 */
export async function notifyAnswered(
  store: Pick<Store, "id" | "slug" | "name" | "markets">,
  test: ExperimentInfo,
  results: Pick<ExperimentResults, "figures" | "splitP" | "days" | "currency">,
): Promise<SendOutcome[]> {
  try {
    const people = await peopleOf(store.id, test.id);
    const verdictIn = (lang: AdminLang) =>
      verdictOf({
        goal: GOAL_WORDS[test.goal] ? test.goal : "orders",
        figures: results.figures,
        splitP: results.splitP,
        days: results.days,
        minVisitors: test.minVisitors,
        minDays: test.minDays,
        currency: results.currency,
        locale: store.markets[0]?.locale ?? "en",
        words: EXPERIMENTS_WORDS[lang],
        numberLocale: ADMIN_LANG_FACTS[lang].locale,
      });
    const targetIn = (lang: AdminLang): string => {
      if (lang === "en") {
        const page = targetLabel(test.page.kind, test.page.slug, test.page.title, test.page.role);
        return test.part ? `${test.part.label} on ${page}` : page;
      }
      const words = EXPERIMENTS_WORDS[lang];
      const page = targetLabelText(test.page.kind, test.page.slug, test.page.title, test.page.role, words);
      return test.part ? fillWords(STAFF_EMAILS_WORDS[lang].guardrail.partOn, { part: partLabelText(test.part.label, words), page }) : page;
    };
    const emails = new Map<AdminLang, ReturnType<typeof renderEmail>>();
    const emailIn = (stored: unknown) => {
      const lang = adminLangOf(typeof stored === "string" ? stored : null);
      if (!emails.has(lang)) {
        const verdict = verdictIn(lang);
        emails.set(
          lang,
          renderEmail(
            answeredEmail(
              {
                storeName: store.name,
                testName: test.name,
                target: targetIn(lang),
                headline: verdict.headline,
                detail: verdict.detail,
                days: results.days,
                url: `${siteUrl()}/admin/${store.slug}/experiments/${test.id}`,
              },
              STAFF_EMAILS_WORDS[lang],
              lang,
            ),
          ),
        );
      }
      return emails.get(lang)!;
    };
    const outcomes: SendOutcome[] = [];
    for (const person of people) {
      await addNotice({ accountId: String(person.id), storeId: store.id, notice: "test_answered", ref: test.id, path: `experiments/${test.id}`, facts: { test: test.name } });
      outcomes.push(
        await sendEmail({
          storeId: store.id,
          kind: "experiment.answered",
          to: String(person.email),
          email: emailIn(person.admin_locale),
          fromName: "Kaizena Flow",
          idempotencyKey: `experiment.answered:${test.id}:${String(person.id)}`,
        }),
      );
    }
    return outcomes;
  } catch (error) {
    log("error", "experiments.answered_notice_failed", { experimentId: test.id }, error);
    return [];
  }
}
