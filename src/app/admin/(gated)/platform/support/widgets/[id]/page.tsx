import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { ActionForm, SubmitButton } from "@/components/admin/action-form";
import { AdminTextScope } from "@/components/admin/admin-text";
import { WidgetEditor } from "@/components/admin/support/widgets/widget-editor";
import { WidgetSites } from "@/components/admin/support/widgets/widget-sites";
import { Card, PageHeader } from "@/components/admin/ui";
import { adminLangOf } from "@/lib/admin-lang";
import { adminText, adminTexts } from "@/lib/admin-text";
import { siteUrl } from "@/lib/site";
import { kaizenDesk } from "@/server/support-desk";
import { widgetPreviewOf } from "@/server/support-widget-view";
import { getWidget } from "@/server/support-widgets";

import {
  addKaizenWidgetSiteAction,
  checkKaizenWidgetSiteAction,
  deleteKaizenWidgetAction,
  installKaizenWidgetFontAction,
  removeKaizenWidgetSiteAction,
  saveKaizenWidgetAction,
} from "../actions";

export const metadata: Metadata = { title: "Chat widget" };

/** One of Kaizena Flow's own chat widgets (D582): its look with a preview, its tag and its websites. */
export default async function KaizenWidgetPage({ params }: PageProps<"/admin/platform/support/widgets/[id]">) {
  const { id } = await params;
  const staff = await kaizenDesk();
  const widget = await getWidget(staff.desk, id);
  if (!widget) notFound();
  const lang = adminLangOf(staff.account.adminLocale);
  const w = adminText(lang, "support").widgets;
  const preview = await widgetPreviewOf(null, widget);
  const write = staff.canWrite;
  return (
    <AdminTextScope texts={adminTexts(lang, ["support", "design"])}>
      <div className="flex flex-col gap-6">
        <PageHeader back={{ href: "/admin/platform/support/widgets", label: w.back }} title={widget.name} description={w.description} />
        {!preview.chatOn && (
          <p role="status" className="rounded-panel border border-warning-line bg-warning-soft px-3 py-2 text-sm text-warning-text">
            {w.chatOff}
          </p>
        )}
        <WidgetSites
          widget={widget}
          origin={siteUrl()}
          add={write ? addKaizenWidgetSiteAction.bind(null, widget.id) : null}
          check={write ? checkKaizenWidgetSiteAction : null}
          remove={write ? removeKaizenWidgetSiteAction : null}
        />
        <WidgetEditor
          widget={widget}
          save={write ? saveKaizenWidgetAction.bind(null, widget.id) : null}
          install={installKaizenWidgetFontAction}
          markets={null}
          themeCss={preview.themeCss}
          colours={preview.colours}
          labels={preview.labels}
        />
        {write && (
          <Card title={w.deleteWidget} description={w.deleteHint}>
            <ActionForm action={deleteKaizenWidgetAction.bind(null, widget.id)}>
              <SubmitButton variant="secondary" skipValidation>
                {w.deleteWidget}
              </SubmitButton>
            </ActionForm>
          </Card>
        )}
      </div>
    </AdminTextScope>
  );
}
