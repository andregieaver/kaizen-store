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

const WORDS: Record<DesignLayoutKind, { one: string; tab: "header" | "footer" | "productLayout"; standard: string; intro: string }> = {
  header: {
    one: "header",
    tab: "header",
    standard: "Kaizen's standard header",
    intro: "The top of every page of a store that applies the profile: its logo, menus, search, account, cart and the rest, with the store's own logo and menus.",
  },
  footer: {
    one: "footer",
    tab: "footer",
    standard: "Kaizen's standard footer",
    intro: "The bottom of every page of a store that applies the profile, with the store's own logo, menus, business details and cookies link.",
  },
  productLayout: {
    one: "product page layout",
    tab: "productLayout",
    standard: "Kaizen's standard product page",
    intro: "How product pages are laid out in a store that applies the profile: rows and columns of product components with anything around them.",
  },
};

/**
 * A design profile's header, footer or product page (D177): the standard one, or its own built in the page builder on the profile's
 * workspace, where every save is the profile's draft.
 */
export async function LayoutTab({ presetId, kind }: { presetId: string; kind: DesignLayoutKind }) {
  const page = await designWorkspacePage(presetId);
  const words = WORDS[kind];
  const type = LAYOUT_PAGE_TYPE[kind];
  if (page.problem !== null) {
    return (
      <DesignShell design={page.design} facts={page.facts} tab={words.tab}>
        <p role="alert" className="rounded-lg border border-border bg-background p-4 text-sm">{page.problem}</p>
      </DesignShell>
    );
  }
  const pageId = await workspaceChosenPage(page.workspace, kind);
  const choose = (choice: "standard" | "build") => chooseWorkspaceLayoutAction.bind(null, presetId, kind, choice);
  if (!pageId) {
    return (
      <DesignShell design={page.design} facts={page.facts} tab={words.tab}>
        <section className="flex max-w-3xl flex-col gap-3 rounded-lg border border-border bg-background p-5">
          <p className="text-sm text-muted">{words.intro}</p>
          <p className="text-sm">
            The profile uses <strong>{words.standard}</strong>: a store that applies it shows the standard {words.one}.
          </p>
          <ActionForm action={choose("build")}>
            <SubmitButton>Build the profile&apos;s own {words.one}</SubmitButton>
          </ActionForm>
        </section>
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
        <p className="max-w-3xl text-sm text-muted">{words.intro} Every save is the profile&apos;s draft; stores get it when the profile is published.</p>
        <ActionForm action={choose("standard")}>
          <SubmitButton variant="secondary">Use {words.standard} instead</SubmitButton>
        </ActionForm>
      </div>
      {editable ? (
        <PageEditor key={editable.id} page={editable} savedParts={saved} terms={[]} gridTerms={gridTerms} fieldRoles={[]} context={context} />
      ) : (
        <p role="alert" className="text-sm">The {words.one} could not be opened. Reload the page.</p>
      )}
    </DesignShell>
  );
}
