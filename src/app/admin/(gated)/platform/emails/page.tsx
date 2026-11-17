import type { Metadata } from "next";
import { connection } from "next/server";

import { EmailLog } from "@/components/admin/email-log";
import { emailEventsSetup } from "@/lib/email-settings";
import { emailSettings, listEmails } from "@/server/email";
import { platformCan, requirePlatformReader } from "@/server/auth";
import { getSendingDomain } from "@/server/sending-domains";
import { SendingDomainCard } from "@/components/admin/sending-domain-card";

import { platformSendingDomainAction } from "./actions";
import { Card, CARD_CLASS, PageHeader } from "@/components/admin/ui";
import { countWords, fillWords } from "@/lib/admin-fill";
import { EMAIL_SHOWS, emailCounts, emailsShown, emailWeek, isEmailShow } from "@/lib/email-log";
import Link from "next/link";
import { CHIP_ITEM, CHIP_STRIP } from "@/lib/chip-strip";
import { ADMIN_LANG_FACTS, adminLangOf } from "@/lib/admin-lang";
import { adminText } from "@/lib/admin-text";

export const metadata: Metadata = { title: "Emails" };

/** Every email Kaizen has sent or logged, and whether sending is set up (D26, D32). */
export default async function PlatformEmailsPage({ searchParams }: PageProps<"/admin/platform/emails">) {
  // Per request: admin pages never read the database while the site is built.
  await connection();
  const account = await requirePlatformReader();
  const lang = adminLangOf(account.adminLocale);
  const w = adminText(lang, "platform").emails;
  const [emails, settings, sending] = await Promise.all([listEmails({ limit: 200 }), Promise.resolve(emailSettings()), getSendingDomain(null)]);
  const webhook = emailEventsSetup() === "ok";
  // Round 16 (D650): a sentence of what went, the setup a fold, chips for what to show, and the emails by day.
  const asked = (await searchParams).show;
  const show = isEmailShow(asked) ? asked : "all";
  const counts = emailCounts(emails);
  const drawnAt = new Date();
  const week = emailWeek(emails, drawnAt.getTime());
  const steps = (
    <div className="flex flex-col gap-2">
      <p>{w.notSetUp}</p>
      <ul className="list-disc pl-5 font-mono text-xs">
        <li>RESEND_API_KEY {w.keyNote}</li>
        <li>EMAIL_FROM {w.fromNote}</li>
        <li>RESEND_WEBHOOK_SECRET {w.secretNote}</li>
      </ul>
      <p className="text-muted">{w.region}</p>
    </div>
  );
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={w.title}
        meta={[settings ? fillWords(w.leadWeek, { sent: week.sent, failed: week.failed }) : countWords(emails.length, w.leadNotSetUp)]}
        description={settings ? undefined : w.leadNotSetUpRest}
      />
      {settings ? (
      <Card title={w.sending} className="text-sm" compact>
          <div className="flex flex-col gap-2">
            <p>
              {w.via.split("{from}")[0]}
              <strong>{settings.from}</strong>
              {w.via.split("{from}")[1]}
            </p>
            {!webhook && (
              <p className="text-muted">
                {w.noWebhook}{" "}
                <span className="font-mono text-xs">{"https://kaizenaflow.com/api/resend/webhook"}</span>
                {w.noWebhookEnd} <span className="font-mono text-xs">{"RESEND_WEBHOOK_SECRET"}</span>.
              </p>
            )}
          </div>
      </Card>
      ) : (
        <details className={`group text-sm ${CARD_CLASS}`}>
          <summary className="flex min-h-14 cursor-pointer list-none flex-wrap items-center justify-between gap-3 px-6 py-3 [&::-webkit-details-marker]:hidden">
            <span className="text-body text-ink">{w.setUpRow}</span>
            <span className="text-sm font-medium text-ink underline underline-offset-2">{w.showSteps}</span>
          </summary>
          <div className="px-6 pb-5">{steps}</div>
        </details>
      )}
      {settings && (
        // Kaizena Flow's own sending domain (D727), as a store's: the shared address is the platform's own until another is verified.
        <SendingDomainCard
          domain={sending && { domain: sending.domain, fromLocal: sending.fromLocal, from: sending.from, status: sending.status, records: sending.records, recordsWritten: sending.recordsWritten, checkedAt: sending.checkedAt }}
          suggested="kaizenaflow.com"
          words={adminText(lang, "notifications").sendingDomain}
          action={platformCan(account, "settings") ? platformSendingDomainAction : null}
          display={ADMIN_LANG_FACTS[lang].tag}
        />
      )}
      <nav aria-label={w.showsLabel} className={CHIP_STRIP}>
        {EMAIL_SHOWS.map((key) => (
          <Link
            key={key}
            href={key === "all" ? "/admin/platform/emails" : `/admin/platform/emails?show=${key}`}
            aria-current={show === key ? "page" : undefined}
            className={`${CHIP_ITEM} inline-flex min-h-9 items-center rounded-pill px-4 text-sm ${show === key ? "bg-inverse text-inverse-ink" : "border border-edge text-ink hover:bg-sunken"}`}
          >
            {fillWords(w.shows[key], { n: counts[key] })}
          </Link>
        ))}
      </nav>
      <Card compact>
        {emailsShown(emails, show).length === 0 && show !== "all" ? (
          <p className="text-sm text-muted">{w.noneShown}</p>
        ) : (
          <EmailLog emails={emailsShown(emails, show)} base="/admin/platform/emails" showStore locale={ADMIN_LANG_FACTS[lang].locale} words={adminText(lang, "notifications")} now={drawnAt.getTime()} quietUnsent={!settings} />
        )}
      </Card>
    </div>
  );
}
