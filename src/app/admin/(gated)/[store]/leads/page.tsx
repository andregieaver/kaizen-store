import type { Metadata } from "next";

import { LeadsList } from "@/components/admin/deals/leads-list";
import { requireFeature } from "@/components/admin/feature-off";
import { PageHeader } from "@/components/admin/ui";
import { countWords } from "@/lib/admin-fill";
import { ADMIN_LANG_FACTS, adminLangOf } from "@/lib/admin-lang";
import { matchPath } from "@/lib/admin-map";
import { adminText } from "@/lib/admin-text";
import { LEAD_SOURCE_PAGES, LEAD_SOURCES, type LeadSource } from "@/lib/leads";
import { canOpenPath } from "@/lib/permissions";
import { requirementMet } from "@/lib/store-features";
import { holderOf } from "@/server/auth";
import { leadsOf } from "@/server/leads";
import { memberCan, requirePermission } from "@/server/permissions";

import { dismissLeadAction, makeLeadDealAction } from "../deals/lead-actions";
import { requireExtension } from "@/components/admin/extension-off";

export const metadata: Metadata = { title: "Leads" };

/**
 * The leads inbox (S4, D475) as a page of its own under Customers (ecosystem plan E2.8, D713): people who asked for something and are not
 * customers yet, one row a person, newest first. What each asked for opens where it is kept (the quote's draft, the conversation, the form's
 * responses, the subscriber) for a viewer who may open that page; Homer makes a deal of a lead or dismisses it. Every member who may read
 * customers sees it while Deals is on; those who may change them decide.
 */
export default async function LeadsPage({ params }: PageProps<"/admin/[store]/leads">) {
  const member = await requirePermission((await params).store, "customers:read");
  const notInAccount = requireExtension(member, "deals");
  if (notInAccount) return notInAccount;
  const off = requireFeature(member, "sales");
  if (off) return off;
  const { store } = member;
  const lang = adminLangOf(member.account.adminLocale);
  const w = adminText(lang, "deals").leads;
  const locale = ADMIN_LANG_FACTS[lang].locale;
  const base = `/admin/${store.slug}`;
  const leads = await leadsOf(store.id);
  // Which sources' pages the viewer may open, asked once a page: their area's key and the feature each stands behind.
  const holder = holderOf(member);
  const open = Object.fromEntries(
    LEAD_SOURCES.map((source) => {
      const page = LEAD_SOURCE_PAGES[source];
      return [source, canOpenPath(holder, page) && requirementMet(store, matchPath(`${base}${page}`)?.page.feature)];
    }),
  ) as Record<LeadSource, boolean>;
  const canChange = memberCan(member, "customers:write");

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={w.title}
        meta={
          leads.length > 0
            ? [
                <span key="lead">
                  <span className="text-ink">{countWords(leads.length, w.count)}</span>
                  {canChange ? w.countRest : ""}
                </span>,
              ]
            : undefined
        }
      />
      <LeadsList
        leads={leads}
        words={w}
        when={(iso) => new Date(iso).toLocaleDateString(locale, { day: "numeric", month: "short", timeZone: store.timeZone })}
        actions={
          canChange
            ? { make: (email) => makeLeadDealAction.bind(null, store.slug, email), dismiss: (email) => dismissLeadAction.bind(null, store.slug, email) }
            : null
        }
        base={base}
        open={open}
      />
    </div>
  );
}
