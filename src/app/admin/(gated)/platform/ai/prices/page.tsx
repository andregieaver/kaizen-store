import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";

import { ActionForm, SubmitButton } from "@/components/admin/action-form";
import { formatPerMillion, formatUnitPrice } from "@/lib/ai-cost";
import { requirePlatformAdmin } from "@/server/auth";
import { listPrices, unpricedModels } from "@/server/ai-prices";

import { setAiPriceAction } from "./actions";

export const metadata: Metadata = { title: "AI prices" };

const input = "min-h-10 rounded-md border border-border bg-background px-3 text-sm font-normal";
const used = (n: number, one: string, many = one) => `${n.toLocaleString("en-GB")} ${n === 1 ? one : many}`;
const usedWords = (m: { tokens: number; images: number; audioSeconds: number; characters: number }) =>
  [
    m.tokens > 0 && `${used(m.tokens, "token", "tokens")}`,
    m.images > 0 && used(m.images, "picture", "pictures"),
    m.audioSeconds > 0 && used(Math.max(1, Math.round(m.audioSeconds / 60)), "minute of audio", "minutes of audio"),
    m.characters > 0 && used(m.characters, "character spoken", "characters spoken"),
  ]
    .filter(Boolean)
    .join(", ");
const date = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeZone: "Europe/Oslo" });

/**
 * What each model costs per million tokens, per picture, per minute of audio and per million characters spoken (D145, D146), so the usage pages can show cost beside what was used. Prices are data kept
 * here, never in code, and never change in place: a new price counts from today (a model's first, from the beginning).
 */
export default async function PlatformAiPricesPage({ searchParams }: PageProps<"/admin/platform/ai/prices">) {
  // Per request: admin pages never read the database while the site is built.
  await connection();
  await requirePlatformAdmin();
  const [prices, unpriced, query] = await Promise.all([listPrices(), unpricedModels(), searchParams]);
  const text = (key: string) => (typeof query[key] === "string" ? (query[key] as string) : "");
  const models = new Map<string, typeof prices>();
  for (const price of prices) models.set(`${price.provider}\u0000${price.model}`, [...(models.get(`${price.provider}\u0000${price.model}`) ?? []), price]);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">AI prices</h1>
        <p className="max-w-2xl text-sm text-muted">
          What each model costs, in US dollars, from the provider&apos;s price list: per million tokens, and where it bills them so, per picture, per minute of audio
          (speech to text and live voice calls) and per million characters spoken.{" "}
          <Link href="/admin/platform/ai/usage" className="underline">
            AI usage
          </Link>{" "}
          multiplies everything a call used by the price its model had that day. Check the prices against the providers&apos; lists now and then: a
          price you change counts from today and leaves earlier calls as they were. A price left empty means &quot;no price&quot;: usage in that unit shows as
          unpriced, with a &quot;+&quot; on the totals.
        </p>
      </div>

      {unpriced.length > 0 && (
        <section aria-labelledby="unpriced" className="rounded-lg border border-border bg-background p-5">
          <h2 id="unpriced" className="font-medium">
            Used without a price
          </h2>
          <p className="mb-3 mt-1 text-sm text-muted">These models were used in the last 90 days with no price for what they did, so the usage pages cannot say what they cost.</p>
          <ul className="flex flex-col divide-y divide-border text-sm">
            {unpriced.map((m) => (
              <li key={`${m.provider}/${m.model}`} className="flex flex-wrap items-baseline gap-x-4 gap-y-1 py-2">
                <span className="min-w-0 flex-1">
                  <span className="font-medium">{m.model}</span> <span className="text-muted">{m.provider}</span>
                </span>
                <span className="tabular-nums text-muted">{usedWords(m)}</span>
                <Link href={`/admin/platform/ai/prices?provider=${encodeURIComponent(m.provider)}&model=${encodeURIComponent(m.model)}#set-price`} className="underline">
                  Set a price
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section aria-labelledby="set-price" className="rounded-lg border border-border bg-background p-5">
        <h2 id="set-price" className="font-medium">
          Set a price
        </h2>
        <ActionForm action={setAiPriceAction} className="mt-3 flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1 text-sm font-medium">
            Provider
            <input name="provider" required defaultValue={text("provider")} placeholder="openai" className={input} />
          </label>
          <label className="flex min-w-56 flex-col gap-1 text-sm font-medium">
            Model
            <input name="model" required defaultValue={text("model")} placeholder="as the usage pages show it" className={input} />
          </label>
          <label className="flex flex-col gap-1 text-sm font-medium">
            Input, $ per million tokens
            <input name="input" required inputMode="decimal" placeholder="0.40" className={`${input} w-40`} />
          </label>
          <label className="flex flex-col gap-1 text-sm font-medium">
            Output, $ per million tokens
            <input name="output" required inputMode="decimal" placeholder="1.60" className={`${input} w-40`} />
          </label>
          <label className="flex flex-col gap-1 text-sm font-medium">
            $ per picture
            <input name="per_image" inputMode="decimal" placeholder="none" className={`${input} w-32`} />
          </label>
          <label className="flex flex-col gap-1 text-sm font-medium">
            $ per minute of audio
            <input name="per_audio_minute" inputMode="decimal" placeholder="none" className={`${input} w-40`} />
          </label>
          <label className="flex flex-col gap-1 text-sm font-medium">
            $ per million characters spoken
            <input name="per_million_characters" inputMode="decimal" placeholder="none" className={`${input} w-48`} />
          </label>
          <label className="flex min-w-56 flex-1 flex-col gap-1 text-sm font-medium">
            Note
            <input name="note" maxLength={300} placeholder="Where the price is from" className={input} />
          </label>
          <SubmitButton>Save price</SubmitButton>
        </ActionForm>
        <p className="mt-2 text-xs text-muted">
          A model&apos;s name also prices its dated versions (a price for <code>gpt-4.1-mini</code> counts for <code>gpt-4.1-mini-2025-04-14</code>). A
          model with no price yet is priced from the beginning, so usage already recorded gets a cost too. Leave the picture, audio and spoken prices
          empty when the model has none, or when the provider bills its pictures or audio as tokens (a call that reports tokens is priced by them, so a
          unit price on top would count twice).
        </p>
      </section>

      <section aria-labelledby="prices" className="rounded-lg border border-border bg-background p-5">
        <h2 id="prices" className="font-medium">
          Prices
        </h2>
        {models.size === 0 ? (
          <p className="mt-2 text-sm text-muted">No prices yet.</p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[56rem] text-left text-sm">
              <thead>
                <tr className="border-b border-border text-muted">
                  <th scope="col" className="px-2 py-2 font-normal">Provider and model</th>
                  <th scope="col" className="px-2 py-2 text-right font-normal">Input per million</th>
                  <th scope="col" className="px-2 py-2 text-right font-normal">Output per million</th>
                  <th scope="col" className="px-2 py-2 text-right font-normal">Per picture</th>
                  <th scope="col" className="px-2 py-2 text-right font-normal">Per audio minute</th>
                  <th scope="col" className="px-2 py-2 text-right font-normal">Per million characters</th>
                  <th scope="col" className="px-2 py-2 font-normal">Since</th>
                  <th scope="col" className="px-2 py-2 font-normal">Note</th>
                </tr>
              </thead>
              <tbody>
                {[...models.values()].flatMap((lines) =>
                  lines.map((line) => (
                    <tr key={line.id} className={`border-b border-border last:border-0 ${line.current ? "" : "text-muted"}`}>
                      <th scope="row" className="px-2 py-2 text-left font-normal">
                        <span className={line.current ? "font-medium" : ""}>{line.model}</span>
                        <span className="block text-xs text-muted">{line.provider}{line.current ? "" : " · earlier price"}</span>
                      </th>
                      <td className="px-2 py-2 text-right tabular-nums">{formatPerMillion(line.inputPerMillion)}</td>
                      <td className="px-2 py-2 text-right tabular-nums">{formatPerMillion(line.outputPerMillion)}</td>
                      <td className="px-2 py-2 text-right tabular-nums">{formatUnitPrice(line.perImage)}</td>
                      <td className="px-2 py-2 text-right tabular-nums">{formatUnitPrice(line.perAudioMinute)}</td>
                      <td className="px-2 py-2 text-right tabular-nums">{formatUnitPrice(line.perMillionCharacters)}</td>
                      <td className="px-2 py-2">{line.effectiveFrom.startsWith("2000-01-01") ? "The beginning" : date.format(new Date(line.effectiveFrom))}</td>
                      <td className="px-2 py-2">{line.note || "–"}</td>
                    </tr>
                  )),
                )}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
