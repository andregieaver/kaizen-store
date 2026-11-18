import type { Metadata } from "next";

import { ActionForm, SubmitButton } from "@/components/admin/action-form";
import { requireFeature } from "@/components/admin/feature-off";
import { Card, List, ListRow, PageHeader } from "@/components/admin/ui";
import { countWords, fillWords } from "@/lib/admin-fill";
import { adminLangOf } from "@/lib/admin-lang";
import { adminText } from "@/lib/admin-text";
import { ensureTemplate } from "@/server/contracts";
import { memberCan, requirePermission } from "@/server/permissions";

import { newTemplateAction } from "../contract-template-actions";
import { requireExtension } from "@/components/admin/extension-off";

export const metadata: Metadata = { title: "Contract templates" };

/**
 * The store's contract templates (D695 step 2): Lisa's depth behind the deals board. Homer has the one made on the first visit and never
 * needs this page; Lisa adds one in Norwegian or English, edits its words and days, and puts one away.
 */
export default async function ContractTemplatesPage({ params }: PageProps<"/admin/[store]/deals/contract-templates">) {
  const { store: slug } = await params;
  const member = await requirePermission(slug, "customers:read");
  const notInAccount = requireExtension(member, "deals");
  if (notInAccount) return notInAccount;
  const off = requireFeature(member, "sales");
  if (off) return off;
  const lang = adminLangOf(member.account.adminLocale);
  const w = adminText(lang, "deals").templates;
  const back = adminText(lang, "deals").title;
  const canChange = memberCan(member, "customers:write");
  const templates = await ensureTemplate(member.store, member.account.id);
  const base = `/admin/${member.store.slug}/deals`;
  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <PageHeader back={{ href: base, label: back }} title={w.title} meta={[w.description]} />
      <Card title={w.title} compact>
        <List label={w.title}>
          {templates.map((t) => (
            <ListRow key={t.id} href={`${base}/contract-templates/${t.id}`}>
              <div className="flex w-full flex-wrap items-center justify-between gap-3 text-sm">
                <span className="font-medium text-ink">{t.name}</span>
                <span className="text-ink-2">
                  {[w.languages[t.language as "nb" | "en"] ?? t.language, fillWords(w.version, { n: t.version }), countWords(t.used, w.used)].join(" · ")}
                </span>
              </div>
            </ListRow>
          ))}
        </List>
        {canChange && (
          <ActionForm action={newTemplateAction.bind(null, member.store.slug)} className="mt-4 flex flex-wrap items-end gap-3">
            <label className="flex flex-col gap-1 text-sm font-medium">
              {w.newIn}
              <select name="language" aria-label={w.newIn} defaultValue={lang === "nb" ? "nb" : "en"} className="min-h-10 rounded-md border border-line bg-card px-3 text-sm font-normal">
                <option value="nb">{w.languages.nb}</option>
                <option value="en">{w.languages.en}</option>
              </select>
            </label>
            <SubmitButton variant="secondary">{w.new}</SubmitButton>
          </ActionForm>
        )}
        <p className="mt-4 text-sm text-muted">{w.notLegal}</p>
      </Card>
    </div>
  );
}
