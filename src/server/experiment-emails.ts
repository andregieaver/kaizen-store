import "server-only";

import { sql } from "drizzle-orm";

import { db } from "@/db/client";
import { targetLabel } from "@/lib/ab-site";
import { fillWords } from "@/lib/admin-fill";
import { adminLangOf, type AdminLang } from "@/lib/admin-lang";
import { adminText } from "@/lib/admin-text";
import { renderEmail } from "@/lib/email-layout";
import { guardrailEmail } from "@/lib/experiment-emails";
import { partLabelText, targetLabelText } from "@/lib/experiment-words";
import { siteUrl } from "@/lib/site";

import { sendEmail, type SendOutcome } from "./email";
import type { ExperimentInfo } from "./experiment-admin";
import type { ExperimentResults } from "./experiment-results";
import { log } from "./log";
import type { Store } from "./stores";

type Row = Record<string, unknown>;

/**
 * Tells a store's owners, and whoever made the test, that the guardrail stopped it (D148, phase 6): once to each, whatever
 * runs the check twice. The figures are `experimentResults()`'s own. It never throws: a failure to send changes nothing
 * about the stop, and the platform's view and the test's page show a guardrail stop anyway.
 */
export async function notifyGuardrailStop(
  store: Pick<Store, "id" | "slug" | "name">,
  test: ExperimentInfo,
  results: Pick<ExperimentResults, "harmed" | "funnel" | "days">,
): Promise<SendOutcome[]> {
  try {
    const harmed = results.harmed ? results.funnel[results.harmed] : null;
    const original = results.funnel.a;
    const version = test.variants.find((v) => v.key === results.harmed);
    if (!results.harmed || !harmed || !original || !version) return [];
    const people = await db().execute<Row>(sql`
      select distinct on (a.id) a.id, a.email, a.admin_locale
      from commerce.store_members m
      join commerce.accounts a on a.id = m.account_id and a.disabled_at is null
      where m.store_id = ${store.id}::uuid and m.disabled_at is null and a.email <> ''
        and (m.role = 'owner' or a.id = (select e.created_by from commerce.experiments e where e.id = ${test.id}::uuid and e.store_id = ${store.id}::uuid))
    `);
    // What was tested, in the reader's language (D312 A10): English as `targetLabel()` writes it, Norwegian from the experiments catalogue.
    const targetIn = (lang: AdminLang): string => {
      if (lang === "en") {
        const page = targetLabel(test.page.kind, test.page.slug, test.page.title, test.page.role);
        return test.part ? `${test.part.label} on ${page}` : page;
      }
      const words = adminText(lang, "experiments");
      const page = targetLabelText(test.page.kind, test.page.slug, test.page.title, test.page.role, words);
      return test.part ? fillWords(adminText(lang, "staffEmails").guardrail.partOn, { part: partLabelText(test.part.label, words), page }) : page;
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
    };
    // One email per language, each in the recipient's own admin language (D312 A10).
    const emails = new Map<string, ReturnType<typeof renderEmail>>();
    const emailIn = (stored: unknown) => {
      const lang = adminLangOf(typeof stored === "string" ? stored : null);
      if (!emails.has(lang))
        emails.set(
          lang,
          renderEmail(
            guardrailEmail(facts, adminText(lang, "staffEmails"), lang),
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
