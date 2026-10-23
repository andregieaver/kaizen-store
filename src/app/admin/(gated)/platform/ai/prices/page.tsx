import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";

import { ActionForm, SubmitButton } from "@/components/admin/action-form";
import { formatPerMillion, formatUnitPrice } from "@/lib/ai-cost";
import { requirePlatformAdmin } from "@/server/auth";
import { listPrices, unpricedModels } from "@/server/ai-prices";
import { Card, PageHeader } from "@/components/admin/ui";
import { countWords, fillWords } from "@/lib/admin-fill";
import { ADMIN_LANG_FACTS, adminLangOf } from "@/lib/admin-lang";
import { adminText } from "@/lib/admin-text";
import type { PlatformToolsMessages } from "@/lib/admin-messages/platform-tools.en";

import { setAiPriceAction } from "./actions";

export const metadata: Metadata = { title: "AI prices" };

const input = "min-h-10 rounded-md border border-line bg-card px-3 text-sm font-normal";
type Words = PlatformToolsMessages["prices"];
const used = (n: number, words: { one: string; many: string }, locale: string) => countWords(n, words, { n: n.toLocaleString(locale) });
const usedWords = (m: { tokens: number; images: number; audioSeconds: number; characters: number }, w: Words, locale: string) =>
  [
    m.tokens > 0 && used(m.tokens, w.token, locale),
    m.images > 0 && used(m.images, w.picture, locale),
    m.audioSeconds > 0 && used(Math.max(1, Math.round(m.audioSeconds / 60)), w.minute, locale),
    m.characters > 0 && used(m.characters, w.character, locale),
  ]
    .filter(Boolean)
    .join(", ");

/**
 * What each model costs per million tokens, per picture, per minute of audio and per million characters spoken (D145, D146), so the usage pages can show cost beside what was used. Prices are data kept
 * here, never in code, and never change in place: a new price counts from today (a model's first, from the beginning).
 */
export default async function PlatformAiPricesPage({ searchParams }: PageProps<"/admin/platform/ai/prices">) {
  // Per request: admin pages never read the database while the site is built.
  await connection();
  const account = await requirePlatformAdmin();
  const lang = adminLangOf(account.adminLocale);
  const locale = ADMIN_LANG_FACTS[lang].locale;
  const w = adminText(lang, "platformTools").prices;
  const date = new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeZone: "Europe/Oslo" });
  const [prices, unpriced, query] = await Promise.all([listPrices(), unpricedModels(), searchParams]);
  const text = (key: string) => (typeof query[key] === "string" ? (query[key] as string) : "");
  const models = new Map<string, typeof prices>();
  for (const price of prices) models.set(`${price.provider}\u0000${price.model}`, [...(models.get(`${price.provider}\u0000${price.model}`) ?? []), price]);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={w.title}
        description={<>{w.intro}{" "}<Link href="/admin/platform/ai/usage" className="underline">{w.usageLink}</Link>{" "}{w.introEnd}</>}
      />

      {unpriced.length > 0 && (
        <Card title={w.unpriced} compact>
          <p className="mb-3 mt-1 text-sm text-muted">{w.unpricedText}</p>
          <ul className="flex flex-col divide-y divide-line text-sm">
            {unpriced.map((m) => (
              <li key={`${m.provider}/${m.model}`} className="flex flex-wrap items-baseline gap-x-4 gap-y-1 py-2">
                <span className="min-w-0 flex-1">
                  <span className="font-medium">{m.model}</span> <span className="text-muted">{m.provider}</span>
                </span>
                <span className="tabular-nums text-muted">{usedWords(m, w, locale)}</span>
                <Link href={`/admin/platform/ai/prices?provider=${encodeURIComponent(m.provider)}&model=${encodeURIComponent(m.model)}#set-price`} className="underline">
                  {w.setPrice}
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card title={w.setPrice} compact>
        <ActionForm action={setAiPriceAction} className="mt-3 flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1 text-sm font-medium">
            {w.provider}
            <input name="provider" required defaultValue={text("provider")} placeholder="openai" className={input} />
          </label>
          <label className="flex min-w-56 flex-col gap-1 text-sm font-medium">
            {w.model}
            <input name="model" required defaultValue={text("model")} placeholder={w.modelHint} className={input} />
          </label>
          <label className="flex flex-col gap-1 text-sm font-medium">
            {w.input}
            <input name="input" required inputMode="decimal" placeholder="0.40" className={`${input} w-40`} />
          </label>
          <label className="flex flex-col gap-1 text-sm font-medium">
            {w.output}
            <input name="output" required inputMode="decimal" placeholder="1.60" className={`${input} w-40`} />
          </label>
          <label className="flex flex-col gap-1 text-sm font-medium">
            {w.perImage}
            <input name="per_image" inputMode="decimal" placeholder={w.none} className={`${input} w-32`} />
          </label>
          <label className="flex flex-col gap-1 text-sm font-medium">
            {w.perAudio}
            <input name="per_audio_minute" inputMode="decimal" placeholder={w.none} className={`${input} w-40`} />
          </label>
          <label className="flex flex-col gap-1 text-sm font-medium">
            {w.perCharacters}
            <input name="per_million_characters" inputMode="decimal" placeholder={w.none} className={`${input} w-48`} />
          </label>
          <label className="flex min-w-56 flex-1 flex-col gap-1 text-sm font-medium">
            {w.note}
            <input name="note" maxLength={300} placeholder={w.noteHint} className={input} />
          </label>
          <SubmitButton>{w.save}</SubmitButton>
        </ActionForm>
        <p className="mt-2 text-xs text-muted">{fillWords(w.versionsNote, { example: "gpt-4.1-mini", dated: "gpt-4.1-mini-2025-04-14" })}</p>
      </Card>

      <Card title={w.prices} compact>
        {models.size === 0 ? (
          <p className="mt-2 text-sm text-muted">{w.noPrices}</p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[56rem] text-left text-sm">
              <thead>
                <tr className="border-b border-line text-muted">
                  <th scope="col" className="px-2 py-2 font-normal">{w.providerAndModel}</th>
                  <th scope="col" className="px-2 py-2 text-right font-normal">{w.inputPerMillion}</th>
                  <th scope="col" className="px-2 py-2 text-right font-normal">{w.outputPerMillion}</th>
                  <th scope="col" className="px-2 py-2 text-right font-normal">{w.perPicture}</th>
                  <th scope="col" className="px-2 py-2 text-right font-normal">{w.perAudioMinute}</th>
                  <th scope="col" className="px-2 py-2 text-right font-normal">{w.perMillionCharacters}</th>
                  <th scope="col" className="px-2 py-2 font-normal">{w.since}</th>
                  <th scope="col" className="px-2 py-2 font-normal">{w.note}</th>
                </tr>
              </thead>
              <tbody>
                {[...models.values()].flatMap((lines) =>
                  lines.map((line) => (
                    <tr key={line.id} className={`border-b border-line last:border-0 ${line.current ? "" : "text-muted"}`}>
                      <th scope="row" className="px-2 py-2 text-left font-normal">
                        <span className={line.current ? "font-medium" : ""}>{line.model}</span>
                        <span className="block text-xs text-muted">{line.provider}{line.current ? "" : w.earlier}</span>
                      </th>
                      <td className="px-2 py-2 text-right tabular-nums">{formatPerMillion(line.inputPerMillion)}</td>
                      <td className="px-2 py-2 text-right tabular-nums">{formatPerMillion(line.outputPerMillion)}</td>
                      <td className="px-2 py-2 text-right tabular-nums">{formatUnitPrice(line.perImage)}</td>
                      <td className="px-2 py-2 text-right tabular-nums">{formatUnitPrice(line.perAudioMinute)}</td>
                      <td className="px-2 py-2 text-right tabular-nums">{formatUnitPrice(line.perMillionCharacters)}</td>
                      <td className="px-2 py-2">{line.effectiveFrom.startsWith("2000-01-01") ? w.beginning : date.format(new Date(line.effectiveFrom))}</td>
                      <td className="px-2 py-2">{line.note || "–"}</td>
                    </tr>
                  )),
                )}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
