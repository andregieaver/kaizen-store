import type { Metadata } from "next";

import { AccessibilityForm } from "@/components/admin/a11y-statement-form";
import { enforcementBodyOf } from "@/lib/a11y-statement";
import { a11yFacts, getA11ySettings } from "@/server/accessibility";
import { requireOwnerRole } from "@/server/permissions";

import { createStatementAction, saveAccessibilityAction } from "./actions";

export const metadata: Metadata = { title: "Accessibility" };

/**
 * What has been assessed against the accessibility requirements and a draft statement (wave 1, 1e). The store owner's page: an assessment is a
 * claim about the business, so only an owner makes it.
 */
export default async function AccessibilityPage({ params }: PageProps<"/admin/[store]/settings/accessibility">) {
  const { store } = await requireOwnerRole((await params).store);
  const [settings, facts] = await Promise.all([getA11ySettings(store.id), a11yFacts(store)]);
  const slug = store.slug;
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Accessibility</h1>
        <p className="max-w-2xl text-sm text-muted">
          Shops sold to consumers in the EU have to be usable by disabled people, and to say how they meet the requirements. Record what has been
          assessed, and make a draft accessibility statement.
        </p>
      </div>
      <AccessibilityForm
        settings={settings}
        facts={facts}
        body={enforcementBodyOf(facts.countries[0] ?? "")}
        contactDefault={store.details.contactEmail ?? null}
        actions={{ save: saveAccessibilityAction.bind(null, slug), createStatement: createStatementAction.bind(null, slug) }}
        legalHref={`/admin/${slug}/settings/legal`}
      />
    </div>
  );
}
