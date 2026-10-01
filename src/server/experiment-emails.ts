import "server-only";

import { sql } from "drizzle-orm";

import { db } from "@/db/client";
import { targetLabel } from "@/lib/ab-site";
import { renderEmail } from "@/lib/email-layout";
import { guardrailEmail } from "@/lib/experiment-emails";
import { siteUrl } from "@/lib/site";

import { sendEmail, type SendOutcome } from "./email";
import type { ExperimentInfo } from "./experiment-admin";
import type { ExperimentResults } from "./experiment-results";
import type { Store } from "./stores";

type Row = Record<string, unknown>;

/**
 * Tells a store's owners, and whoever made the test, that the guardrail stopped it (D148, phase 6): once to each, whatever
 * runs the check twice. The figures are `experimentResults()`'s own. It never throws: a failure to send changes nothing
 * about the stop, and the platform's view and the test's page show a guardrail stop anyway.
 */
export async function notifyGuardrailStop(store: Pick<Store, "id" | "slug" | "name">, test: ExperimentInfo, results: Pick<ExperimentResults, "harmed" | "funnel" | "days">): Promise<SendOutcome[]> {
  try {
    const harmed = results.harmed ? results.funnel[results.harmed] : null;
    const original = results.funnel.a;
    const version = test.variants.find((v) => v.key === results.harmed);
    if (!results.harmed || !harmed || !original || !version) return [];
    const people = await db().execute<Row>(sql`
      select distinct on (a.id) a.id, a.email
      from commerce.store_members m
      join commerce.accounts a on a.id = m.account_id and a.disabled_at is null
      where m.store_id = ${store.id}::uuid and m.disabled_at is null and a.email <> ''
        and (m.role = 'owner' or a.id = (select e.created_by from commerce.experiments e where e.id = ${test.id}::uuid and e.store_id = ${store.id}::uuid))
    `);
    const email = renderEmail(
      guardrailEmail({
        storeName: store.name,
        testName: test.name,
        target: test.part ? `${test.part.label} on ${targetLabel(test.page.kind, test.page.slug, test.page.title)}` : targetLabel(test.page.kind, test.page.slug, test.page.title),
        version: { key: version.key, name: version.name, visitors: harmed.visitors, buyers: harmed.buyers },
        original: { visitors: original.visitors, buyers: original.buyers },
        days: results.days,
        url: `${siteUrl()}/admin/${store.slug}/experiments/${test.id}`,
      }),
    );
    const outcomes: SendOutcome[] = [];
    for (const person of people) {
      outcomes.push(
        await sendEmail({
          storeId: store.id,
          kind: "experiment.guardrail",
          to: String(person.email),
          email,
          fromName: "Kaizen",
          idempotencyKey: `experiment.guardrail:${test.id}:${String(person.id)}`,
        }),
      );
    }
    return outcomes;
  } catch (error) {
    console.error("[experiments] the guardrail email could not be sent", test.id, error);
    return [];
  }
}
