import Link from "next/link";

import { ActionForm, SubmitButton, type FormState } from "@/components/admin/action-form";
import { toolCategories, type TrackingSettings } from "@/lib/cookie-consent";

const input = "min-h-10 w-full rounded-md border border-border bg-background px-3 font-mono text-sm";
const label = "flex flex-col gap-1 text-sm font-medium";
const hint = "text-xs font-normal text-muted";
const card = "flex flex-col gap-4 rounded-lg border border-border bg-background p-5";

const CATEGORY_NAMES = { preferences: "preferences", statistics: "statistics", marketing: "marketing" } as const;

/**
 * A site's analytics and marketing tools (D58), Kaizen's or a store's: each
 * by the id its service gives, loaded only after a visitor allows its
 * category, with a summary of what visitors are asked.
 */
export function TrackingForm({
  tracking,
  action,
  cookiePage,
}: {
  tracking: TrackingSettings;
  action: (state: FormState, form: FormData) => Promise<FormState>;
  cookiePage: string;
}) {
  const asked = toolCategories(tracking);
  return (
    <section aria-labelledby="tools-heading" className={card}>
      <div>
        <h2 id="tools-heading" className="font-medium">
          Analytics and marketing tools
        </h2>
        <p className="text-sm text-muted">
          Each tool loads only after a visitor allows it in the cookie banner, which appears by itself when a tool is on.
          Leave a field empty to switch the tool off.
        </p>
      </div>
      <ActionForm action={action} className="flex flex-col gap-4" successMessage="Saved. The site asks and loads accordingly now.">
        <label className={label}>
          Google Analytics 4
          <input name="ga4" defaultValue={tracking.ga4 ?? ""} placeholder="G-XXXXXXXXXX" className={input} />
          <span className={hint}>Statistics. The measurement id, under Admin → Data streams in Google Analytics.</span>
        </label>
        <label className={label}>
          Google Tag Manager
          <input name="gtm" defaultValue={tracking.gtm ?? ""} placeholder="GTM-XXXXXXX" className={input} />
          <span className={hint}>
            Statistics and marketing: loads once a visitor allows either, and passes their choices on as Google Consent Mode
            signals for the container&apos;s tags.
          </span>
        </label>
        <label className={label}>
          Meta Pixel
          <input name="metaPixel" defaultValue={tracking.metaPixel ?? ""} placeholder="1234567890" inputMode="numeric" className={input} />
          <span className={hint}>Marketing. The pixel id, in Meta Events Manager.</span>
        </label>
        <div>
          <SubmitButton>Save tools</SubmitButton>
        </div>
      </ActionForm>
      <p className="text-sm">
        {asked.length === 0
          ? "No optional tools are on, so visitors see no cookie banner: the site uses only necessary cookies."
          : `Visitors are asked about ${asked.map((c) => CATEGORY_NAMES[c]).join(" and ")} on their first visit.`}{" "}
        <Link href={cookiePage} className="underline" target="_blank" rel="noopener">
          See the cookie page
        </Link>
      </p>
    </section>
  );
}

/** The latest proofs of consent (D58): when, what was asked and what was allowed. */
export function ConsentLog({
  consents,
}: {
  consents: { id: string; visitor: string; choices: Record<string, boolean>; version: string; createdAt: string }[];
}) {
  const date = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Oslo" });
  return (
    <section aria-labelledby="consents-heading" className={card}>
      <div>
        <h2 id="consents-heading" className="font-medium">
          Consents
        </h2>
        <p className="text-sm text-muted">
          Each choice a visitor makes is kept for 12 months as proof, under the random id in their consent cookie. Nothing
          else about them is stored.
        </p>
      </div>
      {consents.length === 0 ? (
        <p className="text-sm text-muted">No choices recorded yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-border text-muted">
                <th scope="col" className="py-2 pr-4 font-normal">When</th>
                <th scope="col" className="py-2 pr-4 font-normal">Visitor</th>
                <th scope="col" className="py-2 pr-4 font-normal">Asked about</th>
                <th scope="col" className="py-2 font-normal">Allowed</th>
              </tr>
            </thead>
            <tbody>
              {consents.map((consent) => {
                const allowed = Object.entries(consent.choices).filter(([, on]) => on).map(([c]) => c);
                return (
                  <tr key={consent.id} className="border-b border-border last:border-0">
                    <td className="py-2 pr-4 whitespace-nowrap">{date.format(new Date(consent.createdAt))}</td>
                    <td className="py-2 pr-4 font-mono text-xs">{consent.visitor.slice(0, 8)}</td>
                    <td className="py-2 pr-4">{consent.version.replaceAll("+", ", ") || "nothing"}</td>
                    <td className="py-2">{allowed.length > 0 ? allowed.join(", ") : "only necessary"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
