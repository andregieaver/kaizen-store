import Link from "next/link";

import { ActionForm, SubmitButton, type FormState } from "@/components/admin/action-form";
import { toolCategories, type TrackingSettings } from "@/lib/cookie-consent";
import { CODE_MAX_LENGTH, CODE_PLACE_LABELS, CODE_PLACES, codeCategories, type CustomCode } from "@/lib/custom-code";

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

const CODE_CATEGORY_CHOICES = [
  ["necessary", "Necessary: added for everyone, no consent needed"],
  ["preferences", "Preferences: added once a visitor allows preferences"],
  ["statistics", "Statistics: added once a visitor allows statistics"],
  ["marketing", "Marketing: added once a visitor allows marketing"],
] as const;

/**
 * A store's own code (D61) for its pages' head and the start and end of
 * their body, each with the cookie category it falls under. Only added on
 * the store's own address (`live`).
 */
export function CustomCodeForm({
  code,
  live,
  action,
}: {
  code: CustomCode;
  /** Whether the store is on its own address, where the code is added (P7). */
  live: boolean;
  action: (state: FormState, form: FormData) => Promise<FormState>;
}) {
  const asked = codeCategories(code);
  return (
    <section aria-labelledby="code-heading" className={card}>
      <div>
        <h2 id="code-heading" className="font-medium">
          Custom code
        </h2>
        <p className="text-sm text-muted">
          Code from other services, such as a tag manager, a chat widget or a verification tag, added to every page of your
          store. Choose what the code does, so it waits for the visitor&apos;s consent where it needs it: code that is not
          necessary for the store to work is only added once a visitor allows its kind of cookies. Only paste code from
          services you trust, as it runs on your store&apos;s pages with full access to them.
        </p>
      </div>
      {!live && (
        <p role="status" className="rounded-md border border-border bg-surface p-3 text-sm">
          Your store is still at Kaizen&apos;s own address. The code is saved now and added once stores move to addresses
          of their own.
        </p>
      )}
      <ActionForm action={action} className="flex flex-col gap-5" successMessage="Saved. Your store adds the code accordingly now.">
        {CODE_PLACES.map((place) => (
          <fieldset key={place} className="flex flex-col gap-2">
            <legend className="text-sm font-medium">{CODE_PLACE_LABELS[place].title}</legend>
            <label className={label}>
              <span className="sr-only">Code {CODE_PLACE_LABELS[place].title.toLowerCase()}</span>
              <textarea
                name={`${place}.code`}
                defaultValue={code[place]?.code ?? ""}
                rows={5}
                maxLength={CODE_MAX_LENGTH}
                spellCheck={false}
                autoCapitalize="off"
                autoCorrect="off"
                className={`${input} py-2`}
              />
              <span className={hint}>{CODE_PLACE_LABELS[place].hint} Leave it empty for none.</span>
            </label>
            <label className={label}>
              What it does
              <select name={`${place}.category`} defaultValue={code[place]?.category ?? "marketing"} className={input.replace("font-mono ", "")}>
                {CODE_CATEGORY_CHOICES.map(([value, text]) => (
                  <option key={value} value={value}>
                    {text}
                  </option>
                ))}
              </select>
            </label>
          </fieldset>
        ))}
        <div>
          <SubmitButton>Save custom code</SubmitButton>
        </div>
      </ActionForm>
      {asked.length > 0 && (
        <p className="text-sm">
          Because of this code, visitors are asked about {asked.map((c) => CATEGORY_NAMES[c]).join(" and ")}. Run a cookie
          scan after saving, and describe what it finds, so your cookie page lists what the code sets.
        </p>
      )}
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
