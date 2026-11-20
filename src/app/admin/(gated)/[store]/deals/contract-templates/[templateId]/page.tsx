import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { z } from "zod";

import { TemplateEditor } from "@/components/admin/deals/template-editor";
import { DeleteDiscountButton } from "@/components/admin/delete-discount-button";
import { requireFeature } from "@/components/admin/feature-off";
import { Card, PageHeader } from "@/components/admin/ui";
import { CONTRACT_CSS, ContractDocumentView } from "@/components/documents/contract-document-view";
import { fillWords } from "@/lib/admin-fill";
import { adminLangOf } from "@/lib/admin-lang";
import { CONTRACT_FIELDS, fillContract, type ContractField } from "@/lib/contract-fields";
import { DEALS_WORDS } from "@/lib/admin-words/deals";
import { getTemplate } from "@/server/contracts";
import { memberCan, requirePermission } from "@/server/permissions";

import { archiveTemplateAction, saveTemplateAction } from "../../contract-template-actions";
import { requireExtension } from "@/components/admin/extension-off";

export const metadata: Metadata = { title: "Contract template" };

const PREVIEW_CSS = CONTRACT_CSS.replace(/@page\s*\{[^}]*\}/, "");

/**
 * One contract template (D695 step 2): its words, language and days, beside how it will look with each field shown by its name (a
 * contract fills them from its deal). Contracts made from it keep the version they were made from.
 */
export default async function ContractTemplatePage({ params }: PageProps<"/admin/[store]/deals/contract-templates/[templateId]">) {
  const { store: slug, templateId } = await params;
  const member = await requirePermission(slug, "customers:read");
  const notInAccount = requireExtension(member, "deals");
  if (notInAccount) return notInAccount;
  const off = requireFeature(member, "sales");
  if (off) return off;
  if (!z.uuid().safeParse(templateId).success) notFound();
  const template = await getTemplate(member, templateId);
  if (!template) notFound();
  const lang = adminLangOf(member.account.adminLocale);
  const deals = DEALS_WORDS[lang];
  const w = deals.templates;
  const canChange = memberCan(member, "customers:write");
  const base = `/admin/${member.store.slug}/deals/contract-templates`;
  // The preview: every field written as its name in brackets, a sample signer on each side.
  const values = Object.fromEntries(CONTRACT_FIELDS.map((key) => [key, `[${deals.contracts.fields[key]}]`])) as Record<ContractField, string>;
  const preview = fillContract(
    {
      title: template.name,
      language: template.language,
      blocks: template.blocks,
      parties: { store: { name: values["store.name"], orgNumber: values["store.org_number"], address: null }, customer: { name: values["customer.name"], orgNumber: null, address: null } },
      signers: [
        { role: "store", name: values["deal.owner"] },
        { role: "customer", name: values["customer.name"] },
      ],
    },
    { values, quote: null },
  ).snapshot;

  return (
    <div className="flex max-w-5xl flex-col gap-6">
      <PageHeader back={{ href: base, label: w.back }} title={template.name} meta={[fillWords(w.version, { n: template.version })]} />
      <div className={canChange ? "grid gap-6 lg:grid-cols-2" : "flex flex-col gap-6"}>
        {canChange && (
          <Card title={deals.contracts.words} compact>
            <TemplateEditor
              initial={{
                name: template.name,
                language: template.language,
                blocks: template.blocks,
                expiresDays: String(template.expiresDays),
                reminderDays: template.reminderDays === null ? "" : String(template.reminderDays),
              }}
              words={w}
              contractWords={deals.contracts}
              save={saveTemplateAction.bind(null, member.store.slug, template.id)}
            />
          </Card>
        )}
        <div className={canChange ? "lg:sticky lg:top-4 lg:max-h-[calc(100vh-2rem)] lg:self-start lg:overflow-y-auto" : undefined}>
          <Card title={w.preview} compact>
            <p className="mb-3 text-sm text-muted">{w.previewHint}</p>
            <div className="rounded-panel border border-line bg-white p-6 text-black">
              <style>{PREVIEW_CSS}</style>
              <ContractDocumentView snapshot={preview} level={2} />
            </div>
          </Card>
        </div>
      </div>
      <p className="text-sm text-muted">{w.notLegal}</p>
      {canChange && <DeleteDiscountButton action={archiveTemplateAction.bind(null, member.store.slug, template.id)} code="" question={w.archiveConfirm} label={w.archive} />}
    </div>
  );
}
