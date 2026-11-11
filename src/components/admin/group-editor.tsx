"use client";

import Link from "next/link";
import { useState, useTransition } from "react";

import { useAdminText } from "@/components/admin/admin-text";
import { card, field, hint, label, primary, secondary } from "@/components/admin/data/ui";

/**
 * A product's combined listing (D566), as staff edit it. Homer names what tells the products apart and this product's value, presses Show
 * together, then adds the others one by one with their values; a colour dot is optional. Each row saves on its own; Take out ends a product's
 * place (and the listing, with fewer than two left). The server's refusals keep the server's words.
 */

type Result = { ok: true } | { ok: false; problem: string };
type Member = { id: string; handle: string; title: string; value: string; swatch: string | null; status: string };

function Message({ message }: { message: { tone: "ok" | "problem"; text: string } | null }) {
  return (
    <div role="status" aria-live="polite">
      {message && <p className={`text-sm ${message.tone === "problem" ? "text-danger-text" : ""}`}>{message.text}</p>}
    </div>
  );
}

function SwatchField({ id, value, onChange, labelText }: { id: string; value: string; onChange: (v: string) => void; labelText: string }) {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className={label}>
        {labelText}
      </label>
      <div className="flex items-center gap-2">
        <input
          id={id}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          maxLength={7}
          className={`${field} w-28 font-mono`}
          spellCheck={false}
        />
        <input type="color" aria-hidden tabIndex={-1} value={/^#[0-9a-f]{6}$/i.test(value) ? value : "#ffffff"} onChange={(e) => onChange(e.target.value)} className="size-10 cursor-pointer rounded-md border border-line bg-card" />
      </div>
    </div>
  );
}

function MemberRow({ member, productHref, canWrite, update, leave }: { member: Member; productHref: string; canWrite: boolean; update: (form: { value: string; swatch: string }) => Promise<Result>; leave: () => Promise<Result> }) {
  const w = useAdminText("products").listing;
  const [value, setValue] = useState(member.value);
  const [swatch, setSwatch] = useState(member.swatch ?? "");
  const [message, setMessage] = useState<{ tone: "ok" | "problem"; text: string } | null>(null);
  const [pending, start] = useTransition();
  const changed = value !== member.value || swatch !== (member.swatch ?? "");
  return (
    <li className="flex flex-wrap items-end gap-3 border-b border-line py-3 last:border-0" data-group-member={member.handle}>
      <div className="flex min-w-48 flex-1 flex-col">
        <Link href={`${productHref}/${member.id}`} className="font-medium underline-offset-2 hover:underline">
          {member.title}
        </Link>
        {member.status !== "active" && <span className={hint}>{w.notActive}</span>}
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor={`value-${member.id}`} className={label}>
          {w.value}
        </label>
        <input id={`value-${member.id}`} value={value} onChange={(e) => setValue(e.target.value)} maxLength={60} className={`${field} w-40`} disabled={!canWrite} />
      </div>
      {canWrite && <SwatchField id={`swatch-${member.id}`} value={swatch} onChange={setSwatch} labelText={w.swatch} />}
      {canWrite && (
        <div className="flex gap-2">
          <button
            type="button"
            disabled={pending || !changed}
            className={secondary}
            onClick={() => start(async () => {
              const r = await update({ value, swatch });
              setMessage(r.ok ? { tone: "ok", text: w.saved } : { tone: "problem", text: r.problem });
            })}
          >
            {w.save}
          </button>
          <button type="button" disabled={pending} className="text-sm underline underline-offset-2" onClick={() => start(async () => void (await leave()))}>
            {w.remove}
          </button>
        </div>
      )}
      <Message message={message} />
    </li>
  );
}

export function GroupEditor({
  group,
  candidates,
  productHref,
  canWrite,
  actions,
}: {
  group: { id: string; option: string; members: Member[] } | null;
  candidates: { id: string; title: string }[];
  productHref: string;
  canWrite: boolean;
  actions: {
    start: (form: { option: string; value: string; swatch: string }) => Promise<Result>;
    add: (otherId: string, form: { value: string; swatch: string }) => Promise<Result>;
    update: (memberId: string, form: { value: string; swatch: string }) => Promise<Result>;
    rename: (option: string) => Promise<Result>;
    leave: (memberId: string) => Promise<Result>;
  };
}) {
  const w = useAdminText("products").listing;
  const [message, setMessage] = useState<{ tone: "ok" | "problem"; text: string } | null>(null);
  const [pending, start] = useTransition();
  const [option, setOption] = useState(group?.option ?? "");
  const [value, setValue] = useState("");
  const [swatch, setSwatch] = useState("");
  const [other, setOther] = useState("");
  const [otherValue, setOtherValue] = useState("");
  const [otherSwatch, setOtherSwatch] = useState("");
  const answer = (r: Result, after?: () => void) => {
    setMessage(r.ok ? { tone: "ok", text: w.saved } : { tone: "problem", text: r.problem });
    if (r.ok) after?.();
  };

  if (!group) {
    if (!canWrite) return null;
    return (
      <form
        aria-label={w.start}
        className={`${card} flex flex-col gap-4`}
        onSubmit={(e) => {
          e.preventDefault();
          start(async () => answer(await actions.start({ option, value, swatch })));
        }}
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-1">
            <label htmlFor="group-option" className={label}>
              {w.option}
            </label>
            <input id="group-option" value={option} onChange={(e) => setOption(e.target.value)} maxLength={40} required className={field} aria-describedby="group-option-hint" />
            <p id="group-option-hint" className={hint}>
              {w.optionHint}
            </p>
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="group-value" className={label}>
              {w.value}
            </label>
            <input id="group-value" value={value} onChange={(e) => setValue(e.target.value)} maxLength={60} required className={field} />
          </div>
        </div>
        <SwatchField id="group-swatch" value={swatch} onChange={setSwatch} labelText={w.swatch} />
        <button type="submit" disabled={pending} className={`${primary} self-start`}>
          {w.start}
        </button>
        <Message message={message} />
      </form>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <section className={`${card} flex flex-col gap-3`} aria-labelledby="group-members">
        <h2 id="group-members" className="text-title text-ink">
          {w.members}
        </h2>
        {canWrite && (
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex flex-col gap-1">
              <label htmlFor="group-option" className={label}>
                {w.option}
              </label>
              <input id="group-option" value={option} onChange={(e) => setOption(e.target.value)} maxLength={40} className={`${field} w-48`} />
            </div>
            <button type="button" disabled={pending || option === group.option} className={secondary} onClick={() => start(async () => answer(await actions.rename(option)))}>
              {w.save}
            </button>
          </div>
        )}
        <ul>
          {group.members.map((m) => (
            <MemberRow
              key={`${m.id}-${m.value}-${m.swatch}`}
              member={m}
              productHref={productHref}
              canWrite={canWrite}
              update={(form) => actions.update(m.id, form)}
              leave={() => actions.leave(m.id)}
            />
          ))}
        </ul>
        <p className={hint}>{w.removeHint}</p>
      </section>
      {canWrite && (
        <form
          aria-label={w.add}
          className={`${card} flex flex-col gap-3`}
          onSubmit={(e) => {
            e.preventDefault();
            start(async () =>
              answer(await actions.add(other, { value: otherValue, swatch: otherSwatch }), () => {
                setOther("");
                setOtherValue("");
                setOtherSwatch("");
              }),
            );
          }}
        >
          <h2 className="text-title text-ink">{w.add}</h2>
          {candidates.length === 0 ? (
            <p className={hint}>{w.none}</p>
          ) : (
            <>
              <div className="flex flex-wrap items-end gap-3">
                <div className="flex flex-col gap-1">
                  <label htmlFor="group-other" className={label}>
                    {w.product}
                  </label>
                  <select id="group-other" value={other} onChange={(e) => setOther(e.target.value)} required className={`${field} max-w-xs`}>
                    <option value="">{w.choose}</option>
                    {candidates.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.title}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="flex flex-col gap-1">
                  <label htmlFor="group-other-value" className={label}>
                    {w.value}
                  </label>
                  <input id="group-other-value" value={otherValue} onChange={(e) => setOtherValue(e.target.value)} maxLength={60} required className={`${field} w-40`} />
                </div>
                <SwatchField id="group-other-swatch" value={otherSwatch} onChange={setOtherSwatch} labelText={w.swatch} />
              </div>
              <button type="submit" disabled={pending} className={`${primary} self-start`}>
                {w.addButton}
              </button>
            </>
          )}
        </form>
      )}
      <Message message={message} />
    </div>
  );
}
