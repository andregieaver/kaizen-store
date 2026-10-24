import type { Metadata } from "next";

import { ActionForm, SubmitButton } from "@/components/admin/action-form";
import { Button, Card, Chip, PageHeader } from "@/components/admin/ui";
import { fillWords } from "@/lib/admin-fill";
import { ADMIN_LANG_FACTS, adminLangOf } from "@/lib/admin-lang";
import { adminText } from "@/lib/admin-text";
import { AD_PLATFORMS } from "@/lib/ad-payloads";
import { listAdConnections } from "@/server/ad-connections";
import { adConversionCounts } from "@/server/ad-conversions";
import { memberCan, requirePermission } from "@/server/permissions";

import { removeAdConnectionAction, saveAdConnectionAction } from "./actions";

export const metadata: Metadata = { title: "Ads and conversions" };

const input = "min-h-10 w-full rounded-md border border-line bg-card px-3 font-mono text-sm";
const label = "flex flex-col gap-1 text-sm";

/**
 * The store's server-side conversion events (wave 5 unit I2, D303, `docs/wave-5-marketing.md` 12.3): per ad platform its connection, what it
 * sends and what happened in the last seven days, counted, never a person. Staff with `marketing:read` see it; only the owner changes it.
 */
export default async function AdsPage({ params }: PageProps<"/admin/[store]/ads">) {
  const member = await requirePermission((await params).store, "marketing:read");
  const { store } = member;
  const owner = memberCan(member, "owner");
  const lang = adminLangOf(member.account.adminLocale);
  const w = adminText(lang, "marketing").ads;
  const common = adminText(lang, "marketing").common;
  const n = (v: number) => v.toLocaleString(ADMIN_LANG_FACTS[lang].locale);
  const [connections, counts] = await Promise.all([listAdConnections(store.id), adConversionCounts(store.id)]);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={w.title} description={w.description} />
      <div className="grid gap-4 lg:grid-cols-2">
        {AD_PLATFORMS.map((platform) => {
          const c = connections.find((x) => x.platform === platform);
          const mine = counts.filter((x) => x.platform === platform);
          return (
            <Card
              key={platform}
              title={w.platforms[platform]}
              compact
              aside={
                <Chip signal={c?.on ? "positive" : "neutral"} dot>
                  {c ? (c.on ? w.connected : common.off) : w.notConnected}
                </Chip>
              }
            >
              <div className="flex flex-col gap-4">
                <div className="text-sm text-ink-2">
                  <p className="text-eyebrow">{w.lastWeek}</p>
                  {mine.length === 0 ? (
                    <p>{w.none}</p>
                  ) : (
                    <ul>
                      {mine.map((x) => (
                        <li key={`${x.status}-${x.answer}`}>
                          {x.status === "sent" || x.status === "pending"
                            ? fillWords(w.sent, { n: n(x.n) })
                            : fillWords(x.status === "failed" ? w.failed : w.skipped, { n: n(x.n), reason: w.reasons[x.answer ?? ""] ?? x.answer ?? "" })}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                {owner ? (
                  <ActionForm action={saveAdConnectionAction.bind(null, store.slug, platform)} className="flex flex-col gap-3" successMessage={w.saved}>
                    <label className={label}>
                      {w.accountLabel[platform]}
                      <input name="accountId" defaultValue={c?.accountId ?? ""} className={input} required />
                    </label>
                    <label className={label}>
                      {w.tokenLabel[platform]}
                      <input name="token" type="password" autoComplete="off" className={input} />
                      {c && <span className="text-caption text-muted">{fillWords(w.tokenSaved, { hint: c.tokenHint })}</span>}
                    </label>
                    <fieldset className="flex flex-col gap-1 text-sm">
                      <legend>{w.level}</legend>
                      <label className="flex items-start gap-2">
                        <input type="radio" name="dataLevel" value="standard" defaultChecked={c?.dataLevel !== "enhanced"} className="mt-1" />
                        {w.standard}
                      </label>
                      <label className="flex items-start gap-2">
                        <input type="radio" name="dataLevel" value="enhanced" defaultChecked={c?.dataLevel === "enhanced"} className="mt-1" />
                        {w.enhanced}
                      </label>
                    </fieldset>
                    <label className={label}>
                      {w.testCode}
                      <input name="testCode" defaultValue={c?.testCode ?? ""} className={input} />
                    </label>
                    <label className="flex items-center gap-2 text-sm">
                      <input type="checkbox" name="on" defaultChecked={c?.on ?? true} />
                      {w.on}
                    </label>
                    <div className="flex flex-wrap gap-2">
                      <SubmitButton>{w.save}</SubmitButton>
                      {c && (
                        <Button type="submit" formAction={removeAdConnectionAction.bind(null, store.slug, platform)}>
                          {w.remove}
                        </Button>
                      )}
                    </div>
                  </ActionForm>
                ) : (
                  <p className="text-sm text-muted">{w.ownerOnly}</p>
                )}
              </div>
            </Card>
          );
        })}
      </div>
      <p className="max-w-3xl text-sm text-muted">{w.note}</p>
    </div>
  );
}
