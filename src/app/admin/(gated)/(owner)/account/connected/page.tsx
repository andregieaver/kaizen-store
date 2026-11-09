import type { Metadata } from "next";
import { connection } from "next/server";

import Link from "next/link";

import { Card, CARD_CLASS, PageHeader, buttonClass, chipClass } from "@/components/admin/ui";
import { fillWords } from "@/lib/admin-fill";
import { ADMIN_LANG_FACTS, adminLangOf } from "@/lib/admin-lang";
import { adminText } from "@/lib/admin-text";
import { HANDOFF_SIGNAL } from "@/lib/kaizen-life-handoffs";
import { resourceUrl } from "@/lib/oauth";
import { siteUrl } from "@/lib/site";
import { requireAccount } from "@/server/auth";
import { kaizenLifeAppUrl, lifeLinkOf } from "@/server/kaizen-life-accounts";
import { recentHandoffsOf } from "@/server/kaizen-life-handoffs";
import { grantsOfAccount } from "@/server/oauth";

import { disconnectGrantAction, switchAssistantsAction, takeBackLifeTaskAction, unlinkKaizenLifeAction } from "./actions";

export const metadata: Metadata = { title: "Connected apps and assistants" };

/**
 * Account → Connected apps and assistants (wave 14 unit B, D439, B7): each AI assistant or app the person let work with their stores, the
 * stores it reaches, its access level and when it was last used, with *Disconnect*, which ends it at once. Everyone's own page, owners and
 * staff alike: a grant acts as the person who made it. A link to Kaizen Life (docs/life-work-summary.md 3.3) stands first, with *Unlink*,
 * and under it the switch that lets the person's assistants here and in Kaizen Life work together (docs/assistants-together.md), and
 * *Between your assistants*: the latest tasks they handed each other, what each came to, and *Take back* for one still open (step 3).
 */
export default async function ConnectedAppsPage(props: { searchParams: Promise<{ assistants?: string }> }) {
  await connection();
  const { assistants: switched } = await props.searchParams;
  const account = await requireAccount();
  const lang = adminLangOf(account.adminLocale);
  const w = adminText(lang, "oauth");
  const [grants, life, lifeApp, tasks] = await Promise.all([
    grantsOfAccount(account.id),
    lifeLinkOf(account.id),
    kaizenLifeAppUrl(account.id),
    recentHandoffsOf(account.id),
  ]);
  const when = (iso: string) => new Date(iso).toLocaleString(ADMIN_LANG_FACTS[lang].locale, { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Oslo" });
  return (
    <div className="flex flex-col gap-8">
      <PageHeader title={w.connected.title} description={w.connected.description} />
      {life ? (
        <section className="max-w-3xl" aria-labelledby="kaizen-life-link">
          <Card compact>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <p id="kaizen-life-link" className="font-medium text-ink">
                  {w.kaizenLife.title}
                </p>
                <p className="text-sm text-ink-2">{fillWords(w.kaizenLife.linked, { when: when(life.linkedAt) })}</p>
                <p className="text-xs text-muted">{w.kaizenLife.how[life.how]}</p>
              </div>
              <div className="flex flex-wrap gap-2">
                {lifeApp ? (
                  <a href={lifeApp} className={buttonClass("secondary")}>
                    {w.kaizenLife.open} ↗
                  </a>
                ) : null}
                <form action={unlinkKaizenLifeAction}>
                  <button type="submit" className={buttonClass("danger")}>
                    {w.kaizenLife.unlink}
                  </button>
                </form>
              </div>
            </div>
          </Card>
          <Card compact className="mt-3">
            <div id="assistants" className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0 max-w-xl">
                <p className="font-medium text-ink">{w.kaizenLife.assistants.title}</p>
                <p className="text-sm text-ink-2">
                  {life.assistants ? fillWords(w.kaizenLife.assistants.on, { when: when(life.assistants.since) }) : w.kaizenLife.assistants.off}
                </p>
                {switched === "failed" && !life.assistants ? (
                  <p role="alert" className="mt-1 text-sm text-danger-text">
                    {w.kaizenLife.assistants.failed}
                  </p>
                ) : null}
              </div>
              <form action={switchAssistantsAction.bind(null, !life.assistants)}>
                <button type="submit" className={buttonClass(life.assistants ? "secondary" : "main")}>
                  {life.assistants ? w.kaizenLife.assistants.turnOff : w.kaizenLife.assistants.turnOn}
                </button>
              </form>
            </div>
          </Card>
          {life.assistants || tasks.length > 0 ? (
            <Card compact className="mt-3">
              <h2 id="between-assistants" className="text-title text-ink">
                {w.kaizenLife.assistants.tasks.title}
              </h2>
              {tasks.length === 0 ? (
                <p className="mt-1 text-sm text-muted">{w.kaizenLife.assistants.tasks.none}</p>
              ) : (
                <ul className="mt-2 flex flex-col divide-y divide-line" aria-labelledby="between-assistants">
                  {tasks.map((task) => (
                    <li key={`${task.direction}:${task.id}`} className="flex flex-col gap-2 py-3">
                      <div className="min-w-0 max-w-2xl">
                        <p className="text-xs text-muted">
                          {task.direction === "to_life"
                            ? w.kaizenLife.assistants.tasks.toLife
                            : task.storeName
                              ? fillWords(w.kaizenLife.assistants.tasks.fromLife, { store: task.storeName })
                              : w.kaizenLife.assistants.tasks.fromLifePlatform}{" "}
                          · {when(task.createdAt)}
                        </p>
                        <p className="line-clamp-2 text-sm text-ink wrap-anywhere">{task.task}</p>
                        {task.result ? <p className="mt-1 line-clamp-2 text-xs text-ink-2 wrap-anywhere">{task.result}</p> : null}
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className={chipClass(HANDOFF_SIGNAL[task.status])}>{w.kaizenLife.assistants.tasks.status[task.status]}</span>
                        {task.href ? (
                          <Link href={task.href} className={buttonClass("quiet", "dense")}>
                            {w.kaizenLife.assistants.tasks.open}
                          </Link>
                        ) : null}
                        {task.open && task.direction === "to_life" ? (
                          <form action={takeBackLifeTaskAction.bind(null, task.id)}>
                            <button type="submit" className={buttonClass("secondary", "dense")}>
                              {w.kaizenLife.assistants.tasks.takeBack}
                            </button>
                          </form>
                        ) : null}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          ) : null}
        </section>
      ) : null}
      {grants.length === 0 ? (
        <p className={`max-w-3xl p-4 text-sm text-muted ${CARD_CLASS}`}>{fillWords(life ? w.connected.noneElse : w.connected.none, { address: resourceUrl(siteUrl(), "mcp") })}</p>
      ) : (
        <ul className="flex max-w-3xl flex-col gap-3">
          {grants.map((grant) => (
            <li key={grant.id}>
              <Card compact>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-medium text-ink">{grant.client.name}</p>
                    <p className="text-sm text-muted">
                      {fillWords(w.consent.from, { host: grant.client.host })} · {grant.client.verified ? w.consent.verified : w.consent.notVerified}
                    </p>
                    <p className="text-sm text-ink-2">{fillWords(w.connected.stores, { stores: grant.stores.map((s) => s.name).join(", ") })}</p>
                    <p className="text-sm text-ink-2">{fillWords(w.connected.level, { level: w.consent.levels[grant.access] })}</p>
                    <p className="text-xs text-muted">
                      {fillWords(w.connected.since, { when: when(grant.createdAt) })} ·{" "}
                      {grant.lastUsedAt ? fillWords(w.connected.lastUsed, { when: when(grant.lastUsedAt) }) : w.connected.neverUsed}
                    </p>
                  </div>
                  <form action={disconnectGrantAction.bind(null, grant.id)}>
                    <button type="submit" className={buttonClass("danger")}>
                      {w.connected.disconnect}
                    </button>
                  </form>
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
