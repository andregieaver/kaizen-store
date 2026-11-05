import type { Metadata } from "next";
import Link from "next/link";

import { ButtonLink, Card, Chip, PageHeader } from "@/components/admin/ui";
import { adminText } from "@/lib/admin-text";
import type { SandboxMessages } from "@/lib/admin-messages/sandbox.en";
import { sandboxBase, sandboxHome, type SandboxKind } from "@/lib/sandbox";
import { requestAdminLang } from "@/server/admin-request-lang";
import { listPages, type PageSummary } from "@/server/pages";

import { offers, sandboxOf } from "./sandbox";

export const metadata: Metadata = { title: "Your store" };

/**
 * The sandbox's home (D457): *Edit the front page* as the one main action, then the store's pages, headers, footers, articles and product
 * layouts (while its shop is on), each to edit or preview, and a new one of each.
 */
export default async function SandboxHome({ params }: PageProps<"/admin/try/[sandbox]">) {
  const { sandbox: id } = await params;
  const sandbox = await sandboxOf(id);
  if (!sandbox) return null;
  const { store } = sandbox;
  const layouts = offers(sandbox, "product_layout");
  const [lang, pages, headers, footers, articles, productLayouts] = await Promise.all([
    requestAdminLang(),
    listPages(store.id, "page"),
    listPages(store.id, "header"),
    listPages(store.id, "footer"),
    listPages(store.id, "article"),
    layouts ? listPages(store.id, "product_layout") : [],
  ]);
  const w = adminText(lang, "sandbox").home;
  const front = pages.find((page) => page.id === store.frontPageId) ?? null;
  const pagesBase = sandboxBase(sandbox.id, "page");
  return (
    <div className="mx-auto flex w-full max-w-[960px] flex-col gap-6 pt-6">
      <PageHeader
        title={w.title}
        description={w.lead}
        actions={
          <>
            <ButtonLink kind="secondary" size="header" href={`${sandboxHome(sandbox.id)}/looks`}>
              {w.looks}
            </ButtonLink>
            <ButtonLink kind="main" size="header" href={front ? `${pagesBase}/${front.id}` : `${pagesBase}/new`}>
              {front ? w.editFront : w.newPage}
            </ButtonLink>
          </>
        }
      />
      <Kind sandboxId={sandbox.id} kind="page" title={w.pages} add={w.newPage} items={pages} frontId={store.frontPageId} w={w} />
      <Kind sandboxId={sandbox.id} kind="header" title={w.headers} add={w.newHeader} items={headers} frontId={null} w={w} />
      <Kind sandboxId={sandbox.id} kind="footer" title={w.footers} add={w.newFooter} items={footers} frontId={null} w={w} />
      <Kind sandboxId={sandbox.id} kind="article" title={w.articles} add={w.newArticle} items={articles} frontId={null} w={w} />
      {layouts && (
        <Kind sandboxId={sandbox.id} kind="product_layout" title={w.productLayouts} add={w.newProductLayout} items={productLayouts} frontId={null} w={w} />
      )}
    </div>
  );
}

function Kind({
  sandboxId,
  kind,
  title,
  add,
  items,
  frontId,
  w,
}: {
  sandboxId: string;
  kind: SandboxKind;
  title: string;
  add: string;
  items: PageSummary[];
  frontId: string | null;
  w: SandboxMessages["home"];
}) {
  const base = sandboxBase(sandboxId, kind);
  return (
    <Card
      title={title}
      aside={
        <ButtonLink kind="secondary" href={`${base}/new`}>
          {add}
        </ButtonLink>
      }
    >
      {items.length === 0 ? (
        <p className="text-body text-muted">{w.none}</p>
      ) : (
        <ul className="flex flex-col divide-y divide-line">
          {items.map((item) => (
            <li key={item.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
              <span className="flex min-w-0 flex-wrap items-center gap-2">
                <Link href={`${base}/${item.id}`} className="truncate text-body-strong text-ink hover:underline">
                  {item.title || w.untitled}
                </Link>
                {item.id === frontId && <Chip signal="positive">{w.front}</Chip>}
                {item.state === "draft" && <Chip>{w.draft}</Chip>}
              </span>
              <span className="flex items-center gap-4 text-body">
                <Link href={`${base}/${item.id}/preview`} className="text-ink-2 underline hover:text-ink">
                  {w.preview}
                </Link>
                <Link href={`${base}/${item.id}`} className="text-ink underline">
                  {w.edit}
                </Link>
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
