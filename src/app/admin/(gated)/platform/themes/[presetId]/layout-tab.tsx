import { ActionForm, SubmitButton } from "@/components/admin/action-form";
import { PageEditor } from "@/components/admin/page-editor";
import { LAYOUT_PAGE_TYPE, designTabHref, type DesignLayoutKind } from "@/lib/design-presets";
import { workspaceChosenPage } from "@/server/design-presets";
import { getPageForEdit } from "@/server/pages";
import { listSavedParts } from "@/server/saved-parts";
import { bothTerms } from "@/server/taxonomy";

import { workspacePageContext } from "./context";
import { designWorkspacePage } from "./data";
import { DesignShell } from "./shell";
import { chooseWorkspaceLayoutAction } from "./workspace-actions";
import { Card } from "@/components/admin/ui";
import { fillWords } from "@/lib/admin-fill";
import { platformSiteWords } from "@/server/platform-site-words";

const TABS: Record<DesignLayoutKind, "header" | "footer" | "productLayout"> = { header: "header", footer: "footer", productLayout: "productLayout" };

/**
 * A design profile's header, footer or product page (D177): the standard one, or its own built in the page builder on the profile's
 * workspace, where every save is the profile's draft.
 */
export async function LayoutTab({ presetId, kind }: { presetId: string; kind: DesignLayoutKind }) {
  const page = await designWorkspacePage(presetId);
  const { w } = await platformSiteWords();
  const words = { ...w.layout[kind], tab: TABS[kind] };
  const l = w.layout;
  const type = LAYOUT_PAGE_TYPE[kind];
  if (page.problem !== null) {
    return (
      <DesignShell design={page.design} facts={page.facts} tab={words.tab}>
        <p role="alert" className="rounded-panel border border-line bg-card p-4 text-sm">{page.problem}</p>
      </DesignShell>
    );
  }
  const pageId = await workspaceChosenPage(page.workspace, kind);
  const choose = (choice: "standard" | "build") => chooseWorkspaceLayoutAction.bind(null, presetId, kind, choice);
  if (!pageId) {
    return (
      <DesignShell design={page.design} facts={page.facts} tab={words.tab}>
        <Card className="flex max-w-3xl flex-col gap-3" compact>
          <p className="text-sm text-muted">{words.intro}</p>
          <p className="text-sm">
            {(() => {
              const [before, after = ""] = fillWords(l.uses, { one: words.one }).split("{standard}");
              return (
                <>
                  {before}
                  <strong>{words.standard}</strong>
                  {after}
                </>
              );
            })()}
          </p>
          <ActionForm action={choose("build")}>
            <SubmitButton>{fillWords(l.build, { one: words.one })}</SubmitButton>
          </ActionForm>
        </Card>
      </DesignShell>
    );
  }
  const [editable, saved, gridTerms, context] = await Promise.all([
    getPageForEdit(page.store.id, pageId, type),
    listSavedParts(page.store.id),
    bothTerms(page.store.id),
    workspacePageContext(page.store, page.workspace, type, designTabHref(presetId, words.tab)),
  ]);
  return (
    <DesignShell design={page.design} facts={page.facts} tab={words.tab}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-3xl text-sm text-muted">
          {words.intro} {l.draftNote}
        </p>
        <ActionForm action={choose("standard")}>
          <SubmitButton variant="secondary">{fillWords(l.useStandard, { standard: words.standard })}</SubmitButton>
        </ActionForm>
      </div>
      {editable ? (
        <PageEditor key={editable.id} page={editable} savedParts={saved} terms={[]} gridTerms={gridTerms} fieldRoles={[]} context={context} />
      ) : (
        <p role="alert" className="text-sm">{fillWords(l.cannotOpen, { one: words.one })}</p>
      )}
    </DesignShell>
  );
}
