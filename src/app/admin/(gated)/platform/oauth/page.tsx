import type { Metadata } from "next";
import { connection } from "next/server";

import { buttonClass, Card, Chip, List, ListRow, PageHeader, RowActions, RowLead } from "@/components/admin/ui";
import { fillWords } from "@/lib/admin-fill";
import { ADMIN_LANG_FACTS, adminLangOf } from "@/lib/admin-lang";
import { adminText } from "@/lib/admin-text";
import { requirePlatformAdmin } from "@/server/auth";
import { clientsSeen } from "@/server/oauth-clients";

import { blockClientAction, verifyClientAction } from "./actions";

export const metadata: Metadata = { title: "AI assistants and apps" };

/**
 * The clients of Kaizena Flow's authorization server (wave 14 unit B, D439, B7): every AI assistant and app that asked, most recently used
 * first, with how many people connected it, its host, and *Verify* and *Block*. Blocking ends every grant it has at once.
 */
export default async function PlatformOAuthPage() {
  await connection();
  const admin = await requirePlatformAdmin();
  const lang = adminLangOf(admin.adminLocale);
  const w = adminText(lang, "oauth").platform;
  const clients = await clientsSeen();
  const when = (iso: string) => new Date(iso).toLocaleString(ADMIN_LANG_FACTS[lang].locale, { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Oslo" });
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={w.title} description={w.description} />
      <Card title={w.title}>
        {clients.length === 0 ? (
          <p className="text-sm text-muted">{w.none}</p>
        ) : (
          <List label={w.title}>
            {clients.map((client) => (
              <ListRow key={client.id}>
                <RowLead
                  title={
                    <span className="flex flex-wrap items-center gap-2">
                      {client.name}
                      {client.verified && <Chip signal="positive">{w.verified}</Chip>}
                      {client.blocked && <Chip signal="danger">{w.blocked}</Chip>}
                    </span>
                  }
                  sub={
                    <>
                      {client.host} · {w.kinds[client.kind]} · {fillWords(w.people, { people: client.people, grants: client.grants })} ·{" "}
                      {client.lastSeenAt ? fillWords(w.seen, { when: when(client.lastSeenAt) }) : w.neverSeen}
                      <span className="block break-all font-mono text-xs">{client.clientId}</span>
                    </>
                  }
                />
                <RowActions>
                  <form action={verifyClientAction.bind(null, client.id, !client.verified)}>
                    <button type="submit" className={buttonClass("secondary", "dense")}>
                      {client.verified ? w.unverify : w.verify}
                    </button>
                  </form>
                  <form action={blockClientAction.bind(null, client.id, !client.blocked)}>
                    <button type="submit" className={buttonClass(client.blocked ? "secondary" : "danger", "dense")}>
                      {client.blocked ? w.unblock : w.block}
                    </button>
                  </form>
                </RowActions>
              </ListRow>
            ))}
          </List>
        )}
      </Card>
    </div>
  );
}
