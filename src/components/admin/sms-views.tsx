"use client";

import { useState, useTransition } from "react";

import { useAdminText } from "@/components/admin/admin-text";
import { field, hint, label, primary, secondary } from "@/components/admin/data/ui";
import { countWords, fillWords } from "@/lib/admin-fill";
import { QUIET_EARLIEST, QUIET_LATEST, SMS_PARTS_MAX, SMS_TEXT_MAX, smsBody, smsParts } from "@/lib/sms";

/**
 * SMS marketing's parts of the admin (D565, `docs/sms-marketing.md`). Homer connects the account with three fields and writes a text with a
 * name, who it is for and the words, sees what each reader gets and its price, and presses Send; Lisa's rules (reply number, hours, cap) are in
 * their own card. In the admin's language; the server's refusals keep the server's words.
 */

type Result = { ok: true } | { ok: false; problem: string };

function Message({ message }: { message: { tone: "ok" | "problem"; text: string } | null }) {
  return (
    <div role="status" aria-live="polite">
      {message && <p className={`text-sm ${message.tone === "problem" ? "text-danger-text" : ""}`}>{message.text}</p>}
    </div>
  );
}

function Text({ id, name, title, value, onChange, type = "text", help, ...rest }: { id: string; name: string; title: string; value: string; onChange: (v: string) => void; type?: string; help?: string } & Record<string, unknown>) {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className={label}>
        {title}
      </label>
      <input id={id} name={name} type={type} value={value} onChange={(e) => onChange(e.target.value)} className={field} aria-describedby={help ? `${id}-hint` : undefined} {...rest} />
      {help && (
        <p id={`${id}-hint`} className={hint}>
          {help}
        </p>
      )}
    </div>
  );
}

/** Connecting the store's 46elks account: the username, the password and the sender name. */
export function SmsConnectForm({ connect }: { connect: (form: Record<string, string>) => Promise<Result> }) {
  const w = useAdminText("marketing").sms;
  const [values, setValues] = useState({ username: "", password: "", sender: "" });
  const [message, setMessage] = useState<{ tone: "ok" | "problem"; text: string } | null>(null);
  const [pending, start] = useTransition();
  const set = (key: keyof typeof values) => (v: string) => setValues({ ...values, [key]: v });
  return (
    <form
      aria-label={w.connectTitle}
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        start(async () => {
          const result = await connect(values);
          setMessage(result.ok ? { tone: "ok", text: w.connected } : { tone: "problem", text: result.problem });
        });
      }}
    >
      <p className="max-w-[75ch] text-body text-muted">{w.connectIntro}</p>
      <div className="grid gap-3 sm:grid-cols-3">
        <Text id="sms-username" name="username" title={w.username} value={values.username} onChange={set("username")} autoComplete="off" required />
        <Text id="sms-password" name="password" title={w.password} value={values.password} onChange={set("password")} type="password" autoComplete="new-password" required />
        <Text id="sms-sender" name="sender" title={w.sender} value={values.sender} onChange={set("sender")} help={w.senderHint} maxLength={11} required />
      </div>
      <button type="submit" disabled={pending} className={`${primary} self-start`}>
        {w.connect}
      </button>
      <Message message={message} />
    </form>
  );
}

export type SmsSettingsValues = { sender: string; replyNumber: string; quietFrom: number; quietUntil: number; monthlyCap: number; currency: string };

/** The account's rules (the owner's): sender, reply number, the hours texts arrive and the month's cap; and disconnecting. */
export function SmsSettingsForm({
  initial,
  save,
  disconnect,
}: {
  initial: SmsSettingsValues;
  save: (form: Record<string, string>) => Promise<Result>;
  disconnect: () => Promise<Result>;
}) {
  const w = useAdminText("marketing").sms;
  const c = useAdminText("marketing").common;
  const [values, setValues] = useState({ sender: initial.sender, replyNumber: initial.replyNumber, quietFrom: String(initial.quietFrom), quietUntil: String(initial.quietUntil), monthlyCap: String(initial.monthlyCap) });
  const [message, setMessage] = useState<{ tone: "ok" | "problem"; text: string } | null>(null);
  const [pending, start] = useTransition();
  const set = (key: keyof typeof values) => (v: string) => setValues({ ...values, [key]: v });
  const hours = Array.from({ length: QUIET_LATEST - QUIET_EARLIEST + 1 }, (_, i) => QUIET_EARLIEST + i);
  return (
    <form
      aria-label={w.settingsTitle}
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        start(async () => {
          const result = await save(values);
          setMessage(result.ok ? { tone: "ok", text: c.saved } : { tone: "problem", text: result.problem });
        });
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Text id="sms-set-sender" name="sender" title={w.sender} value={values.sender} onChange={set("sender")} help={w.senderHint} maxLength={11} required />
        <Text id="sms-set-reply" name="replyNumber" title={w.replyNumber} value={values.replyNumber} onChange={set("replyNumber")} help={w.replyHint} type="tel" placeholder="+46766861217" />
      </div>
      <fieldset className="flex flex-col gap-1">
        <legend className={label}>{w.hours}</legend>
        <div className="flex flex-wrap items-center gap-2">
          <select aria-label={`${w.hours} (${QUIET_EARLIEST}–${QUIET_LATEST - 1})`} value={values.quietFrom} onChange={(e) => set("quietFrom")(e.target.value)} className={field}>
            {hours.slice(0, -1).map((h) => (
              <option key={h} value={h}>{`${String(h).padStart(2, "0")}:00`}</option>
            ))}
          </select>
          <span>{w.and}</span>
          <select aria-label={`${w.and} (${QUIET_EARLIEST + 1}–${QUIET_LATEST})`} value={values.quietUntil} onChange={(e) => set("quietUntil")(e.target.value)} className={field}>
            {hours.slice(1).map((h) => (
              <option key={h} value={h}>{`${String(h).padStart(2, "0")}:00`}</option>
            ))}
          </select>
        </div>
        <p className={hint}>{w.hoursHint}</p>
      </fieldset>
      <Text id="sms-set-cap" name="monthlyCap" title={fillWords(w.cap, { currency: initial.currency })} value={values.monthlyCap} onChange={set("monthlyCap")} type="number" min={0} step={1} help={w.capHint} />
      <div className="flex flex-wrap gap-3">
        <button type="submit" disabled={pending} className={primary}>
          {c.save}
        </button>
        <button
          type="button"
          disabled={pending}
          className={secondary}
          onClick={() => {
            if (!window.confirm(w.disconnectConfirm)) return;
            start(async () => {
              const result = await disconnect();
              if (!result.ok) setMessage({ tone: "problem", text: result.problem });
            });
          }}
        >
          {w.disconnect}
        </button>
      </div>
      <Message message={message} />
    </form>
  );
}

/** Staff stopping a number for its owner. */
export function StopNumberButton({ stop }: { stop: () => Promise<Result> }) {
  const w = useAdminText("marketing").sms;
  const [pending, start] = useTransition();
  return (
    <button type="button" disabled={pending} className="text-sm underline underline-offset-2" onClick={() => start(async () => void (await stop()))}>
      {w.stopFor}
    </button>
  );
}

type Preview = { ok: true; recipients: number; parts: number; estimate: number; currency: string; spent: number; cap: number; withinCap: boolean; body: string } | { ok: false; problem: string };

/**
 * A text message's draft: its name, who gets it and the words, with what each reader gets and how many texts that is as it is typed; then its
 * price (46elks's own) and Send. Once started it shows what happened instead (`SmsCampaignControls`).
 */
export function SmsCampaignEditor({
  id,
  initial,
  segments,
  storeName,
  lang,
  numbers,
  save,
  preview,
  send,
  remove,
}: {
  id: string | null;
  initial: { title: string; text: string; segmentId: string };
  segments: { id: string; name: string }[];
  storeName: string;
  lang: string;
  numbers: string;
  save: (form: { title: string; text: string; segmentId: string }) => Promise<Result>;
  preview: (() => Promise<Preview>) | null;
  send: (() => Promise<Result>) | null;
  remove: (() => Promise<Result>) | null;
}) {
  const all = useAdminText("marketing");
  const w = all.sms;
  const [values, setValues] = useState(initial);
  const [message, setMessage] = useState<{ tone: "ok" | "problem"; text: string } | null>(null);
  const [price, setPrice] = useState<Extract<Preview, { ok: true }> | null>(null);
  const [pending, start] = useTransition();
  const shown = smsBody({ storeName, text: values.text || "…", stopUrl: "https://kaizenaflow.com/sms/AbCdEfGhIjKlMnOpQrStUv", lang });
  const parts = smsParts(shown).parts;
  const changed = values.title !== initial.title || values.text !== initial.text || values.segmentId !== initial.segmentId;
  const people = (n: number) => countWords(n, all.common.people, { n: n.toLocaleString(numbers) });
  const money = (v: number) => v.toLocaleString(numbers, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  return (
    <form
      aria-label={w.newText}
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        start(async () => {
          const result = await save(values);
          setPrice(null);
          setMessage(result.ok ? { tone: "ok", text: all.common.saved } : { tone: "problem", text: result.problem });
        });
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Text id="sms-title" name="title" title={w.name} value={values.title} onChange={(v) => setValues({ ...values, title: v })} maxLength={120} required />
        <div className="flex flex-col gap-1">
          <label htmlFor="sms-audience" className={label}>
            {w.audience}
          </label>
          <select id="sms-audience" value={values.segmentId} onChange={(e) => setValues({ ...values, segmentId: e.target.value })} className={field}>
            <option value="">{w.everyone}</option>
            {segments.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor="sms-text" className={label}>
          {w.message}
        </label>
        <textarea
          id="sms-text"
          rows={4}
          maxLength={SMS_TEXT_MAX}
          value={values.text}
          onChange={(e) => setValues({ ...values, text: e.target.value })}
          className={`${field} py-2`}
          aria-describedby="sms-text-hint sms-parts"
          required
        />
        <p id="sms-text-hint" className={hint}>
          {w.messageHint}
        </p>
      </div>
      <section aria-labelledby="sms-preview" className="flex flex-col gap-2">
        <h3 id="sms-preview" className={label}>
          {w.preview}
        </h3>
        <p className="max-w-sm whitespace-pre-line break-words rounded-2xl rounded-bl-sm bg-card px-4 py-3 text-sm shadow-sm" data-sms-preview>
          {shown}
        </p>
        <p id="sms-parts" className={`${hint} ${parts > SMS_PARTS_MAX ? "text-danger-text" : ""}`}>
          {countWords(parts, w.parts, { n: parts })}
        </p>
      </section>
      <div className="flex flex-wrap gap-3">
        <button type="submit" disabled={pending || (!changed && id !== null)} className={secondary}>
          {w.saveDraft}
        </button>
        {preview && (
          <button
            type="button"
            disabled={pending || changed}
            className={secondary}
            onClick={() =>
              start(async () => {
                setMessage({ tone: "ok", text: w.pricing });
                const result = await preview();
                if (result.ok) {
                  setPrice(result);
                  setMessage(null);
                } else setMessage({ tone: "problem", text: result.problem });
              })
            }
          >
            {w.price}
          </button>
        )}
        {send && price && price.withinCap && price.recipients > 0 && (
          <button
            type="button"
            disabled={pending || changed}
            className={primary}
            onClick={() => {
              if (!window.confirm(fillWords(w.sendConfirm, { people: people(price.recipients) }))) return;
              start(async () => {
                const result = await send();
                setMessage(result.ok ? { tone: "ok", text: w.started } : { tone: "problem", text: result.problem });
              });
            }}
          >
            {w.sendNow}
          </button>
        )}
        {remove && (
          <button type="button" disabled={pending} className="text-sm underline underline-offset-2" onClick={() => start(async () => void (await remove()))}>
            {w.deleteDraft}
          </button>
        )}
      </div>
      {price && (
        <p className="text-body" data-sms-price>
          {fillWords(w.estimate, { people: people(price.recipients), cost: money(price.estimate), currency: price.currency, spent: money(price.spent), cap: money(price.cap) })}
          {!price.withinCap && <span className="block text-danger-text">{w.overCap}</span>}
        </p>
      )}
      <Message message={message} />
    </form>
  );
}

/** A started text message's Stop. */
export function SmsStopButton({ stop }: { stop: () => Promise<Result> }) {
  const w = useAdminText("marketing").sms;
  const [pending, start] = useTransition();
  const [done, setDone] = useState<string | null>(null);
  return (
    <div className="flex items-center gap-3">
      <button type="button" disabled={pending} className={secondary} onClick={() => start(async () => setDone((await stop()).ok ? w.stopped : null))}>
        {w.stop}
      </button>
      <span role="status">{done}</span>
    </div>
  );
}
