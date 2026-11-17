import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { AdminTextScope } from "@/components/admin/admin-text";
import { FormEditor } from "@/components/admin/forms/form-editor";
import { FormTabs } from "@/components/admin/forms/form-tabs";
import { SaveAsTemplateCard } from "@/components/admin/forms/form-template-parts";
import { PAGE_TYPE_COPY } from "@/components/admin/page-type-copy";
import { Chip, PageHeader } from "@/components/admin/ui";
import { ADMIN_LANG_FACTS, adminLangOf } from "@/lib/admin-lang";
import { adminText, adminTexts } from "@/lib/admin-text";
import type { PageType } from "@/lib/page-content";
import { signupCodeChoices } from "@/server/discounts";
import { formUses, getForm } from "@/server/forms-admin";
import { formPaymentChosen } from "@/server/form-payments";
import { templatesOfForm } from "@/server/form-templates";
import { isStoreOwner } from "@/server/templates";
import { memberCan, requirePermission } from "@/server/permissions";

import { deleteFormAction, saveAsTemplateAction, saveFormAction, searchFormPaymentAction, setFormStatusAction, updateTemplateAction } from "../actions";

export const metadata: Metadata = { title: "Form" };

/** One of the store's forms (D705): what it asks, who it emails, where it shows; its responses are a tab away, read with the customers. */
export default async function FormPage({ params }: PageProps<"/admin/[store]/forms/[formId]">) {
  const { store: slug, formId } = await params;
  const member = await requirePermission(slug, "website:read");
  const { store, account } = member;
  const form = await getForm(store.id, formId);
  if (!form) notFound();
  const lang = adminLangOf(account.adminLocale);
  const w = adminText(lang, "forms");
  const [uses, codes, linked, owner, paying] = await Promise.all([
    formUses(store.id, form.id),
    form.kind === "signup" ? signupCodeChoices(store.id) : Promise.resolve([]),
    templatesOfForm({ accountId: account.id, storeId: store.id }, form.id, store.markets[0]?.lang ?? "en"),
    isStoreOwner(account.id, store.id),
    form.kind === "message" ? formPaymentChosen(store.id, form.paymentVariantId) : Promise.resolve(null),
  ]);
  const base = `/admin/${store.slug}/forms`;
  // The store's other languages (F3), named in the admin's language, for the words a visitor in them sees.
  const langs = [...new Set(store.markets.map((m) => m.lang))];
  const names = new Intl.DisplayNames([ADMIN_LANG_FACTS[lang].locale], { type: "language" });
  const languages = langs.slice(1).map((code) => ({ code, name: names.of(code) ?? code }));
  return (
    <AdminTextScope texts={adminTexts(lang, ["forms", "blocks", "formTemplates"])}>
      <div className="flex flex-col gap-6">
        <PageHeader
          back={{ href: base, label: w.title }}
          eyebrow={w.kinds[form.kind]}
          status={form.status === "archived" ? <Chip>{w.list.archived}</Chip> : undefined}
          title={form.name}
        />
        <FormTabs formHref={`${base}/${form.id}`} responsesHref={`${base}/responses/${form.id}`} current="form" words={w.tabs} />
        <FormEditor
          key={form.id}
          form={form}
          siteLang={langs[0] ?? "en"}
          languages={languages}
          inboxChoice
          canEdit={memberCan(member, "website:write")}
          codes={codes}
          placedOn={uses.map((u) => ({ ...u, href: `/admin/${store.slug}/${PAGE_TYPE_COPY[u.type as PageType]?.segment ?? "pages"}/${u.pageId}` }))}
          templates={
            <SaveAsTemplateCard
              formName={form.name}
              mayShare={owner}
              linked={linked}
              starter={null}
              saveAs={saveAsTemplateAction.bind(null, store.slug, form.id)}
              update={updateTemplateAction.bind(null, store.slug)}
            />
          }
          payment={form.kind === "message" ? { chosen: paying, search: searchFormPaymentAction.bind(null, store.slug) } : undefined}
          listHref={base}
          save={saveFormAction.bind(null, store.slug, form.id)}
          setStatus={setFormStatusAction.bind(null, store.slug, form.id)}
          remove={deleteFormAction.bind(null, store.slug, form.id)}
        />
      </div>
    </AdminTextScope>
  );
}
