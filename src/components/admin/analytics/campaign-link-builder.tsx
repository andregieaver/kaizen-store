"use client";

import { useState } from "react";

import { ActionForm, SubmitButton } from "@/components/admin/action-form";

import type { SpendActions } from "./spend-form";

type FormAction = SpendActions["add"];
import { useAdminText } from "@/components/admin/admin-text";
import { fillWords } from "@/lib/admin-fill";
import { campaignLink, LINK_MEDIUMS, type LinkMedium } from "@/lib/analytics-campaigns";
import { channelLabel } from "@/lib/analytics-traffic";

const field = "min-h-10 w-full rounded-md border border-line bg-card px-3 text-sm";
const label = "flex flex-col gap-1 text-sm";

/**
 * The campaign-link builder (D303 I3): a store page's address with the tags, made in the browser by `campaignLink()`, which also says the
 * channel the visit will count in. Only the store's own addresses (`origins`). Nothing is saved.
 */
export function CampaignLinkBuilder({ origins, start }: { origins: string[]; start: string }) {
  const w = useAdminText("reports");
  const c = w.campaigns;
  const [address, setAddress] = useState(start);
  const [source, setSource] = useState("");
  const [medium, setMedium] = useState<LinkMedium>("paid_social");
  const [campaign, setCampaign] = useState("");
  const [copied, setCopied] = useState(false);
  const link = campaignLink({ address, source, medium, campaign }, origins);
  const ready = source.trim() !== "" && campaign.trim() !== "";
  return (
    <div className="flex flex-col gap-3 rounded-panel border border-line p-4">
      <h3 className="text-body-strong text-ink">{c.builderTitle}</h3>
      <div className="grid gap-3 md:grid-cols-2">
        <label className={label}>
          {c.address}
          <input className={field} value={address} onChange={(e) => setAddress(e.target.value)} />
        </label>
        <label className={label}>
          {c.source}
          <input className={field} value={source} placeholder={c.sourcePlaceholder} onChange={(e) => setSource(e.target.value)} />
        </label>
        <label className={label}>
          {c.medium}
          <select className={field} value={medium} onChange={(e) => setMedium(e.target.value as LinkMedium)}>
            {LINK_MEDIUMS.map((m) => (
              <option key={m} value={m}>
                {c.mediums[m]}
              </option>
            ))}
          </select>
        </label>
        <label className={label}>
          {c.campaign}
          <input className={field} value={campaign} placeholder={c.campaignPlaceholder} onChange={(e) => setCampaign(e.target.value)} />
        </label>
      </div>
      {link ? (
        <div className="flex flex-col gap-2">
          <code className="break-all rounded-md bg-sunken px-3 py-2 text-sm">{link.url}</code>
          <p className="text-sm text-muted">
            {fillWords(c.countsAs, { channel: (w.channels as Record<string, string>)[link.channel] ?? channelLabel(link.channel) })}
          </p>
          <div>
            <button
              type="button"
              className="rounded-pill border border-line px-3 py-1 text-sm"
              onClick={() => void navigator.clipboard?.writeText(link.url).then(() => setCopied(true))}
            >
              {copied ? c.copied : c.copy}
            </button>
          </div>
        </div>
      ) : (
        <p className="text-sm text-muted">{ready ? c.notOwnAddress : c.fillIn}</p>
      )}
    </div>
  );
}

/** The spend import: a CSV file with day, channel, campaign and amount. */
export function SpendImportForm({ action, currency }: { action: FormAction; currency: string }) {
  const c = useAdminText("reports").campaigns;
  return (
    <ActionForm action={action} className="flex flex-col gap-2 rounded-panel border border-line p-4">
      <h3 className="text-body-strong text-ink">{c.importTitle}</h3>
      <p className="text-sm text-muted">{fillWords(c.importHelp, { currency })}</p>
      <input type="file" name="file" accept=".csv,text/csv" required className="text-sm" />
      <div>
        <SubmitButton>{c.importButton}</SubmitButton>
      </div>
    </ActionForm>
  );
}
