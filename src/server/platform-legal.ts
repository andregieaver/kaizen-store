import "server-only";

import { sql } from "drizzle-orm";

import { db, readDb } from "@/db/client";
import { audit, type Account } from "@/server/auth";
import { savePage } from "@/server/pages";
import { parseBusinessDetails, type BusinessDetails } from "@/lib/navigation";
import { pageExcerpt, parsePageContent, type PageContent } from "@/lib/page-content";
import {
  legalPageContent,
  missingFacts,
  PLATFORM_LEGAL_KINDS,
  PLATFORM_LEGAL_SLUGS,
  type PlatformLegalFacts,
  type PlatformLegalKind,
} from "@/lib/platform-legal";

type Row = Record<string, unknown>;

export type LegalPageState = { kind: PlatformLegalKind; slug: string; id: string | null; published: boolean; written: boolean };
export type LegalPagesOverview = { pages: LegalPageState[]; missing: (keyof BusinessDetails)[] };

export type LegalWriteOutcome = { kind: PlatformLegalKind; outcome: "made" | "written" | "kept" | "failed"; id: string | null; problems?: string[] };

/** The facts the pages are written from: Kaizena Flow's business details and its sale fee. */
async function platformFacts(today: Date): Promise<PlatformLegalFacts> {
  const [row] = await readDb().execute<Row>(sql`select business, sale_fee_bps from commerce.platform_settings`);
  return { business: parseBusinessDetails(row?.business), saleFeeBps: Number(row?.sale_fee_bps ?? 0), today };
}

/** Kaizena Flow's own page at an address, with what it shows (null: none there). */
async function pageAt(slug: string): Promise<{ id: string; published: PageContent | null } | null> {
  const [row] = await db().execute<Row>(sql`
    select id, published from commerce.pages where store_id is null and type = 'page' and slug = ${slug}
  `);
  return row ? { id: String(row.id), published: row.published ? parsePageContent(row.published) : null } : null;
}

/** A page counts as written when it is published with words of its own: the empty privacy page made with the site is not. */
const hasWords = (content: PageContent | null): boolean => content !== null && pageExcerpt(content).trim().length > 0;

/** Where each of the three pages stands, and which business details the texts would show as placeholders. */
export async function platformLegalOverview(): Promise<LegalPagesOverview> {
  const facts = await platformFacts(new Date());
  const pages = await Promise.all(
    PLATFORM_LEGAL_KINDS.map(async (kind): Promise<LegalPageState> => {
      const slug = PLATFORM_LEGAL_SLUGS[kind];
      const page = await pageAt(slug);
      return { kind, slug, id: page?.id ?? null, published: Boolean(page?.published), written: hasWords(page?.published ?? null) };
    }),
  );
  return { pages, missing: missingFacts(facts.business) };
}

/**
 * Writes and publishes Kaizena Flow's terms, privacy notice and data processing agreement in English and Norwegian (D312 P5). A page
 * that is missing is made; one that is published with words of its own is kept unless `overwrite` names it; the rest are written over.
 * Each goes through `savePage()` and is published at once (no review, the owner's decision). Audit-logged as `platform.legal_pages_written`.
 */
export async function writePlatformLegalPages(admin: Account, { overwrite = [] }: { overwrite?: readonly PlatformLegalKind[] } = {}): Promise<LegalWriteOutcome[]> {
  const facts = await platformFacts(new Date());
  const outcomes: LegalWriteOutcome[] = [];
  for (const kind of PLATFORM_LEGAL_KINDS) {
    const existing = await pageAt(PLATFORM_LEGAL_SLUGS[kind]);
    if (existing && hasWords(existing.published) && !overwrite.includes(kind)) {
      outcomes.push({ kind, outcome: "kept", id: existing.id });
      continue;
    }
    const saved = await savePage(admin, null, existing?.id ?? null, legalPageContent(kind, facts), { publish: true, type: "page" });
    outcomes.push(
      saved.ok
        ? { kind, outcome: existing ? "written" : "made", id: saved.id }
        : { kind, outcome: "failed", id: existing?.id ?? null, problems: saved.problems },
    );
  }
  await audit(admin.id, null, "platform.legal_pages_written", {
    pages: outcomes.map((o) => ({ kind: o.kind, outcome: o.outcome, page: o.id })),
    missing: missingFacts(facts.business),
  });
  return outcomes;
}
