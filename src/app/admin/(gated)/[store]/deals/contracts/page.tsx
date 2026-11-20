import type { Metadata } from "next";

import { requireExtension } from "@/components/admin/extension-off";
import { requireFeature } from "@/components/admin/feature-off";
import { ButtonLink, Card, Chip, EmptyState, List, ListRow, PageHeader } from "@/components/admin/ui";
import { fillWords } from "@/lib/admin-fill";
import { ADMIN_LANG_FACTS, adminLangOf } from "@/lib/admin-lang";
import { DEALS_WORDS } from "@/lib/admin-words/deals";
import { contractVersions } from "@/lib/contract-versions";
import { listContracts, type ContractStatus } from "@/server/contracts";
import { requirePermission } from "@/server/permissions";

export const metadata: Metadata = { title: "Contracts" };

const signal = (status: ContractStatus) =>
  status === "signed" ? "positive" : status === "declined" || status === "expired" || status === "cancelled" ? "danger" : "neutral";

/**
 * The store's contracts across its deals (D857), under Deals in the menu: newest first, each with its deal, the customer who signs, its
 * version and where it stands, opening the contract's own page. Contracts are made on a deal; templates are one step away.
 */
export default async function ContractsPage({ params }: PageProps<"/admin/[store]/deals/contracts">) {
  const { store: slug } = await params;
  const member = await requirePermission(slug, "customers:read");
  const notInAccount = requireExtension(member, "deals");
  if (notInAccount) return notInAccount;
  const off = requireFeature(member, "sales");
  if (off) return off;
  const lang = adminLangOf(member.account.adminLocale);
  const w = DEALS_WORDS[lang].contracts;
  const locale = ADMIN_LANG_FACTS[lang].locale;
  const when = (iso: string) => new Date(iso).toLocaleDateString(locale, { dateStyle: "medium", timeZone: member.store.timeZone });
  const base = `/admin/${member.store.slug}/deals`;
  const rows = await listContracts(member);
  const versions = contractVersions(rows);
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={w.list.title}
        meta={[w.list.intro]}
        actions={
          <ButtonLink kind="quiet" href={`${base}/contract-templates`}>
            {w.list.templates}
          </ButtonLink>
        }
      />
      <Card compact>
        {rows.length === 0 ? (
          <EmptyState title={w.list.none} />
        ) : (
          <List label={w.list.title}>
            {rows.map((r) => (
              <ListRow key={r.id} href={r.dealId ? `${base}/${r.dealId}/contracts/${r.id}` : undefined}>
                <div className="flex w-full flex-wrap items-center justify-between gap-3 text-sm">
                  <span className="flex min-w-0 flex-col">
                    <span className="font-medium text-ink">{r.title}</span>
                    <span className="text-ink-2">{[r.dealTitle ?? w.list.noDeal, r.customer].filter(Boolean).join(" · ")}</span>
                  </span>
                  <span className="flex flex-wrap items-center gap-3 text-ink-2">
                    <span>{fillWords(w.version, { n: versions.get(r.id)?.number ?? 1 })}</span>
                    <span>{r.completedAt ? fillWords(w.signedOn, { date: when(r.completedAt) }) : r.sentAt ? fillWords(w.sentOn, { date: when(r.sentAt) }) : fillWords(w.madeOn, { date: when(r.createdAt) })}</span>
                    <Chip signal={signal(r.status)}>{w.statuses[r.status]}</Chip>
                  </span>
                </div>
              </ListRow>
            ))}
          </List>
        )}
      </Card>
    </div>
  );
}
