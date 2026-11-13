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
import { requirePermission } from "@/server/permissions";
import { memberDesk } from "@/server/support-desk";
import { widgetPreviewOf } from "@/server/support-widget-view";
import { getWidget } from "@/server/support-widgets";

import {
  addWidgetSiteAction,
  checkWidgetSiteAction,
  deleteWidgetAction,
  installWidgetFontAction,
  removeWidgetSiteAction,
  saveWidgetAction,
} from "../actions";

export const metadata: Metadata = { title: "Chat widget" };

/** One of the store's chat widgets (D581): its look with a preview, its tag and its websites. */
export default async function SupportWidgetPage({ params }: PageProps<"/admin/[store]/support/widgets/[id]">) {
  const { store: slug, id } = await params;
  const member = await requirePermission(slug, "support:read");
  const staff = memberDesk(member);
  const widget = await getWidget(staff.desk, id);
  if (!widget) notFound();
  const lang = adminLangOf(member.account.adminLocale);
  const w = adminText(lang, "support").widgets;
  const preview = await widgetPreviewOf(member.store, widget);
  const write = staff.canWrite;
  return (
    <AdminTextScope texts={adminTexts(lang, ["support", "design"])}>
      <div className="flex flex-col gap-6">
        <PageHeader back={{ href: `/admin/${slug}/support/widgets`, label: w.back }} title={widget.name} description={w.description} />
        {!preview.chatOn && (
          <p role="status" className="rounded-panel border border-warning-line bg-warning-soft px-3 py-2 text-sm text-warning-text">
            {w.chatOff}
          </p>
        )}
        <WidgetSites
          widget={widget}
          origin={siteUrl()}
          add={write ? addWidgetSiteAction.bind(null, slug, widget.id) : null}
          check={write ? checkWidgetSiteAction.bind(null, slug) : null}
          remove={write ? removeWidgetSiteAction.bind(null, slug) : null}
        />
        <WidgetEditor
          widget={widget}
          save={write ? saveWidgetAction.bind(null, slug, widget.id) : null}
          install={installWidgetFontAction.bind(null, slug)}
          markets={member.store.markets.map((market) => ({ slug: market.slug, name: market.name }))}
          themeCss={preview.themeCss}
          colours={preview.colours}
          labels={preview.labels}
        />
        {write && (
          <Card title={w.deleteWidget} description={w.deleteHint}>
            <ActionForm action={deleteWidgetAction.bind(null, slug, widget.id)}>
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
