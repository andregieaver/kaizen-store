import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";

import { buttonClass, Card, CARD_CLASS, List, ListRow, PageHeader, RowLead } from "@/components/admin/ui";
import { fillWords } from "@/lib/admin-fill";
import { adminLangOf } from "@/lib/admin-lang";
import { adminText } from "@/lib/admin-text";
import { requireAccount } from "@/server/auth";
import { appsOf, developerOf } from "@/server/developer-apps";

import { becomeDeveloperAction } from "./actions";

export const metadata: Metadata = { title: "Developer" };

/**
 * Account → Developer (wave 14 unit D, D441): developer mode, turned on by accepting the developer terms, then the account's apps for many
 * stores, each with how many stores it is installed on and where its listing stands, and *New app*.
 */
export default async function DeveloperPage({ searchParams }: PageProps<"/admin/account/developer">) {
  await connection();
  const account = await requireAccount();
  const lang = adminLangOf(account.adminLocale);
  const w = adminText(lang, "oauth").developer;
  const developer = await developerOf(account.id);
  const problem = (await searchParams).problem;
  if (!developer) {
    return (
      <div className="flex flex-col gap-8">
        <PageHeader title={w.title} description={w.description} />
        <Card title={w.becomeTitle} description={w.become}>
          <form action={becomeDeveloperAction} className="flex flex-col gap-3">
            {problem === "terms" && (
              <p role="alert" className="text-sm text-danger-text">
                {w.terms}
              </p>
            )}
            <label className="flex items-start gap-2 text-sm">
              <input type="checkbox" name="terms" required className="mt-0.5 size-4" />
              <span>
                {w.terms} (
                <a href="/docs/developers/apps/developer-terms" className="underline" target="_blank" rel="noreferrer">
                  {w.termsLink}
                </a>
                )
              </span>
            </label>
            <div>
              <button type="submit" className={buttonClass("main")}>
                {w.start}
              </button>
            </div>
          </form>
        </Card>
      </div>
    );
  }
  const apps = await appsOf(account.id);
  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title={w.title}
        description={w.description}
        actions={
          <Link href="/admin/account/developer/new" className={buttonClass("main", "header")}>
            {w.newApp}
          </Link>
        }
      />
      {apps.length === 0 ? (
        <p className={`max-w-3xl p-4 text-sm text-muted ${CARD_CLASS}`}>{w.none}</p>
      ) : (
        <Card title={w.apps}>
          <List label={w.apps}>
            {apps.map((app) => (
              <ListRow key={app.id} href={`/admin/account/developer/${app.id}`}>
                <RowLead
                  title={app.name}
                  href={`/admin/account/developer/${app.id}`}
                  sub={
                    <>
                      {w.distributions[app.distribution]} · {fillWords(w.installations, { n: String(app.installations) })}
                      {app.listing ? ` · ${fillWords(w.listing[app.listing], { note: app.listingNote ?? "" })}` : ""}
                      {app.blocked ? ` · ${w.blocked}` : ""}
                    </>
                  }
                />
              </ListRow>
            ))}
          </List>
        </Card>
      )}
    </div>
  );
}
