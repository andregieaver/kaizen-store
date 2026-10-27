import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";

import { Card, Chip, List, ListRow, PageHeader, RowLead } from "@/components/admin/ui";
import { fillWords } from "@/lib/admin-fill";
import { ADMIN_LANG_FACTS } from "@/lib/admin-lang";
import { THEMES_ADMIN } from "@/lib/theme-admin-paths";
import { SUBMISSION_SIGNAL } from "@/lib/theme-submissions";
import { requirePlatformAdmin } from "@/server/auth";
import { platformSiteWords } from "@/server/platform-site-words";
import { listSubmissions, type QueueFilter } from "@/server/theme-submissions";

export const metadata: Metadata = { title: "Submissions" };

const tab = "flex min-h-10 items-center rounded-md border border-edge px-3 text-sm hover:bg-sunken aria-[current=page]:bg-sunken aria-[current=page]:font-medium";

/**
 * The review queue of themes from outside (wave 7 unit J, D344): looks stores shared as themes, oldest first while open, each opened to be
 * reviewed (made a draft theme), approved (published) or not accepted with a reason. `?show=decided` lists the decided ones.
 */
export default async function SubmissionsPage({ searchParams }: PageProps<"/admin/platform/themes/submissions">) {
  await connection();
  const admin = await requirePlatformAdmin();
  const { lang, w } = await platformSiteWords();
  const s = w.submissions;
  const filter: QueueFilter = (await searchParams).show === "decided" ? "decided" : "open";
  const rows = await listSubmissions(admin, filter);
  const date = new Intl.DateTimeFormat(ADMIN_LANG_FACTS[lang].locale, { dateStyle: "medium" });
  return (
    <div className="flex flex-col gap-6">
      <PageHeader back={{ href: THEMES_ADMIN, label: w.themes.title }} title={s.title} description={s.description} />
      <nav aria-label={s.title} className="flex flex-wrap gap-2">
        <Link href={`${THEMES_ADMIN}/submissions`} aria-current={filter === "open" ? "page" : undefined} className={tab}>
          {s.open}
        </Link>
        <Link href={`${THEMES_ADMIN}/submissions?show=decided`} aria-current={filter === "decided" ? "page" : undefined} className={tab}>
          {s.decided}
        </Link>
      </nav>
      <Card>
        {rows.length === 0 ? (
          <p className="text-sm text-muted">{filter === "open" ? s.none : s.noneDecided}</p>
        ) : (
          <List label={s.title}>
            {rows.map((row) => (
              <ListRow key={row.id}>
                <RowLead
                  title={row.kind === "update" ? fillWords(s.update, { title: row.presetTitle ?? row.title }) : row.title}
                  href={`${THEMES_ADMIN}/submissions/${row.id}`}
                  sub={`${row.kind === "update" ? "" : `${s.newTheme} · `}${fillWords(s.by, { author: row.authorName })} · ${fillWords(s.from, { store: row.storeName })} · ${date.format(new Date(row.createdAt))}`}
                />
                <Chip signal={SUBMISSION_SIGNAL[row.status]}>{s.status[row.status]}</Chip>
              </ListRow>
            ))}
          </List>
        )}
      </Card>
    </div>
  );
}
