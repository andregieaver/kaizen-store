"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { useAdminText } from "@/components/admin/admin-text";
import { card, field, hint, label, primary, secondary } from "@/components/admin/data/ui";
import type { Passport } from "@/lib/product-passport";

type Save = (raw: unknown, publish: boolean) => Promise<{ ok: true; id: string; published: boolean } | { ok: false; problem: string }>;

/**
 * A product's passport (D554): the materials and the care, repair and end-of-life texts in view (what most products need), the rest one step
 * away under More. Save as a draft, publish, or take it offline. The server checks every field again (`passportInput`).
 */
export function PassportEditor({ initial, published, countries, save }: { initial: Passport; published: boolean; countries: { code: string; name: string }[]; save: Save }) {
  const w = useAdminText("products").passport;
  const router = useRouter();
  const [p, setP] = useState<Passport>(initial);
  const [more, setMore] = useState(Boolean(initial.originCountry || initial.substances || initial.certifications.length || initial.documents.length || initial.carbon || initial.sparePartsYears || initial.durabilityYears));
  const [message, setMessage] = useState<{ tone: "ok" | "problem"; text: string } | null>(null);
  const [pending, start] = useTransition();
  const set = <K extends keyof Passport>(key: K, value: Passport[K]) => setP({ ...p, [key]: value });
  const num = (v: string): number | null => (v.trim() === "" ? null : Number(v));

  const run = (publish: boolean, done: string) =>
    start(async () => {
      setMessage(null);
      const result = await save(p, publish);
      if (!result.ok) return setMessage({ tone: "problem", text: result.problem });
      setMessage({ tone: "ok", text: done });
      router.refresh();
    });

  return (
    <form
      className="flex flex-col gap-5"
      onSubmit={(e) => {
        e.preventDefault();
        run(true, w.published);
      }}
    >
      <fieldset className={`${card} flex flex-col gap-3`}>
        <legend className="text-title text-ink">{w.materials}</legend>
        {p.materials.map((m, i) => (
          <div key={i} className="flex flex-wrap items-end gap-2">
            <label className="flex flex-col gap-1">
              <span className={label}>{w.material}</span>
              <input value={m.name} maxLength={80} onChange={(e) => set("materials", p.materials.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} className={`${field} w-48`} />
            </label>
            <label className="flex flex-col gap-1">
              <span className={label}>{w.percent}</span>
              <input type="number" min={0} max={100} step="0.1" value={m.percent} onChange={(e) => set("materials", p.materials.map((x, j) => (j === i ? { ...x, percent: Number(e.target.value) } : x)))} className={`${field} w-28`} />
            </label>
            <label className="flex flex-col gap-1">
              <span className={label}>{w.recycled}</span>
              <input type="number" min={0} max={100} step="1" value={m.recycledPercent} onChange={(e) => set("materials", p.materials.map((x, j) => (j === i ? { ...x, recycledPercent: Number(e.target.value) } : x)))} className={`${field} w-28`} />
            </label>
            <button type="button" onClick={() => set("materials", p.materials.filter((_, j) => j !== i))} className="min-h-10 text-sm underline">
              {w.remove}
            </button>
          </div>
        ))}
        {p.materials.length < 20 && (
          <button type="button" onClick={() => set("materials", [...p.materials, { name: "", percent: 0, recycledPercent: 0 }])} className={`${secondary} self-start`}>
            {w.addMaterial}
          </button>
        )}
      </fieldset>

      {(["care", "repair", "endOfLife"] as const).map((key) => (
        <label key={key} className="flex flex-col gap-1">
          <span className={label}>{w[key]}</span>
          <textarea rows={3} maxLength={2000} value={p[key]} onChange={(e) => set(key, e.target.value)} className={`${field} py-2`} />
        </label>
      ))}

      {!more ? (
        <button type="button" onClick={() => setMore(true)} className="self-start text-sm underline underline-offset-2">
          {w.more}
        </button>
      ) : (
        <div className={`${card} flex flex-col gap-4`}>
          <div className="grid gap-3 sm:grid-cols-3">
            <label className="flex flex-col gap-1">
              <span className={label}>{w.origin}</span>
              <select value={p.originCountry} onChange={(e) => set("originCountry", e.target.value)} className={field}>
                <option value="">{w.noOrigin}</option>
                {countries.map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className={label}>{w.spareParts}</span>
              <input type="number" min={0} max={30} value={p.sparePartsYears ?? ""} onChange={(e) => set("sparePartsYears", num(e.target.value))} className={field} />
            </label>
            <label className="flex flex-col gap-1">
              <span className={label}>{w.durability}</span>
              <input type="number" min={0} max={100} value={p.durabilityYears ?? ""} onChange={(e) => set("durabilityYears", num(e.target.value))} className={field} />
            </label>
          </div>
          <label className="flex flex-col gap-1">
            <span className={label}>{w.substances}</span>
            <textarea rows={2} maxLength={1000} value={p.substances} onChange={(e) => set("substances", e.target.value)} className={`${field} py-2`} />
          </label>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-1">
              <span className={label}>{w.carbon}</span>
              <input
                type="number"
                min={0}
                step="0.01"
                value={p.carbon?.kgCo2e ?? ""}
                onChange={(e) => set("carbon", e.target.value === "" ? null : { kgCo2e: Number(e.target.value), method: p.carbon?.method ?? "" })}
                className={field}
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className={label}>{w.carbonMethod}</span>
              <input value={p.carbon?.method ?? ""} maxLength={200} disabled={!p.carbon} onChange={(e) => p.carbon && set("carbon", { ...p.carbon, method: e.target.value })} className={field} />
            </label>
          </div>
          <fieldset className="flex flex-col gap-2">
            <legend className={label}>{w.certifications}</legend>
            {p.certifications.map((c, i) => (
              <div key={i} className="flex flex-wrap items-end gap-2">
                {(["name", "number", "url"] as const).map((k) => (
                  <label key={k} className="flex flex-col gap-1">
                    <span className={hint}>{k === "name" ? w.certName : k === "number" ? w.certNumber : w.certUrl}</span>
                    <input value={c[k]} onChange={(e) => set("certifications", p.certifications.map((x, j) => (j === i ? { ...x, [k]: e.target.value } : x)))} className={`${field} w-44`} />
                  </label>
                ))}
                <button type="button" onClick={() => set("certifications", p.certifications.filter((_, j) => j !== i))} className="min-h-10 text-sm underline">
                  {w.remove}
                </button>
              </div>
            ))}
            {p.certifications.length < 10 && (
              <button type="button" onClick={() => set("certifications", [...p.certifications, { name: "", number: "", url: "" }])} className={`${secondary} self-start`}>
                {w.addCert}
              </button>
            )}
          </fieldset>
          <fieldset className="flex flex-col gap-2">
            <legend className={label}>{w.documents}</legend>
            {p.documents.map((d, i) => (
              <div key={i} className="flex flex-wrap items-end gap-2">
                <label className="flex flex-col gap-1">
                  <span className={hint}>{w.docTitle}</span>
                  <input value={d.title} onChange={(e) => set("documents", p.documents.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)))} className={`${field} w-48`} />
                </label>
                <label className="flex flex-col gap-1">
                  <span className={hint}>{w.docUrl}</span>
                  <input value={d.url} onChange={(e) => set("documents", p.documents.map((x, j) => (j === i ? { ...x, url: e.target.value } : x)))} className={`${field} w-64`} />
                </label>
                <button type="button" onClick={() => set("documents", p.documents.filter((_, j) => j !== i))} className="min-h-10 text-sm underline">
                  {w.remove}
                </button>
              </div>
            ))}
            {p.documents.length < 10 && (
              <button type="button" onClick={() => set("documents", [...p.documents, { title: "", url: "" }])} className={`${secondary} self-start`}>
                {w.addDoc}
              </button>
            )}
          </fieldset>
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <button type="submit" disabled={pending} className={primary}>
          {w.publish}
        </button>
        <button type="button" disabled={pending} onClick={() => run(false, published ? w.unpublished : w.saved)} className={secondary}>
          {published ? w.unpublish : w.saveDraft}
        </button>
      </div>
      <div role="status" aria-live="polite">
        {message && <p className={`text-sm ${message.tone === "problem" ? "text-danger-text" : ""}`}>{message.text}</p>}
      </div>
    </form>
  );
}
