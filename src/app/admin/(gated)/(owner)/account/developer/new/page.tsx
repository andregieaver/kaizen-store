import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { connection } from "next/server";

import { AdminTextScope } from "@/components/admin/admin-text";
import { AppForm } from "@/components/admin/developer-apps";
import { Card, PageHeader } from "@/components/admin/ui";
import { adminLangOf } from "@/lib/admin-lang";
import { adminText, adminTexts } from "@/lib/admin-text";
import { requireAccount } from "@/server/auth";
import { developerOf } from "@/server/developer-apps";

import { createAppAction } from "../actions";
import { appFormChoices } from "../app-form-data";

export const metadata: Metadata = { title: "New app" };

/** Account → Developer → New app (D441): the form; the app's client ID and secrets are shown once when it is made. */
export default async function NewAppPage() {
  await connection();
  const account = await requireAccount();
  if (!(await developerOf(account.id))) redirect("/admin/account/developer");
  const lang = adminLangOf(account.adminLocale);
  const w = adminText(lang, "oauth").developer;
  return (
    <AdminTextScope texts={adminTexts(lang, ["oauth"])}>
      <div className="flex flex-col gap-8">
        <PageHeader title={w.newTitle} description={w.description} />
        <Card>
          <AppForm
            isNew
            initial={{ name: "", description: "", logoUrl: "", homepageUrl: "", privacyUrl: "", supportEmail: "", redirectUris: [], scopes: [], distribution: "private", webhookUrl: "", webhookHint: null, webhookTopics: [] }}
            {...appFormChoices(lang)}
            save={createAppAction}
          />
        </Card>
      </div>
    </AdminTextScope>
  );
}
