"use client";

import { useState, useTransition, type ChangeEvent } from "react";

import { field } from "@/components/admin/data/ui";
import { fillWords } from "@/lib/admin-fill";
import { formatMoney } from "@/lib/money";
import { PURCHASE_KINDS, PURCHASE_VAT_RATES, type PurchaseKind } from "@/lib/purchases";

import type { BillReadResult } from "@/app/admin/(gated)/[store]/settings/books/actions";

export type BillFieldWords = {
  file: string;
  supplier: string;
  number: string;
  issuedOn: string;
  dueOn: string;
  amount: string;
  what: string;
  vatRate: string;
  vatUsual: string;
  vatNone: string;
  vatAbroad: string;
  kinds: Record<string, string>;
  more: string;
  organisationNumber: string;
  words: string;
  reading: string;
  readFrom: string;
  readBare: string;
  unread: string;
  otherCurrency: string;
};

/**
 * The fields of a bill (D492, D493): its file first, then who it is from, its number and days, the amount, what it was and its VAT. When the
 * owner chooses the file, the store's model reads it (`read`, `readBillAction()`) and fills what it found; the owner checks it and adds the
 * bill with the form's button. Nothing is posted here.
 */
export function BillFields({
  today,
  openedOn,
  currency,
  locale,
  words,
  read,
}: {
  today: string;
  openedOn: string;
  currency: string;
  locale: string;
  words: BillFieldWords;
  read: (form: FormData) => Promise<BillReadResult>;
}) {
  const [supplier, setSupplier] = useState("");
  const [number, setNumber] = useState("");
  const [issuedOn, setIssuedOn] = useState(today);
  const [dueOn, setDueOn] = useState("");
  const [amount, setAmount] = useState("");
  const [kind, setKind] = useState<string>("office");
  const [vat, setVat] = useState<string>("usual");
  const [org, setOrg] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const [reading, start] = useTransition();

  const chosen = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    setNote(null);
    if (!file) return;
    start(async () => {
      setNote(words.reading);
      const form = new FormData();
      form.set("bill", file);
      const r = await read(form).catch(() => null);
      if (!r || !r.ok) {
        setNote(r?.reason === "unread" || r?.reason === "not_readable" ? words.unread : null);
        return;
      }
      if (r.supplier) setSupplier(r.supplier);
      if (r.number) setNumber(r.number);
      if (r.issuedOn && r.issuedOn >= openedOn) setIssuedOn(r.issuedOn);
      if (r.dueOn) setDueOn(r.dueOn);
      if (r.totalMinor !== null) setAmount((r.totalMinor / 100).toFixed(2));
      if (r.kind) setKind(r.kind);
      if (r.abroad) setVat("abroad");
      else if (r.vatRate !== null) setVat(String(r.vatRate));
      if (r.organisationNumber) setOrg(r.organisationNumber);
      if (r.otherCurrency) {
        setNote(fillWords(words.otherCurrency, { currency: r.otherCurrency, books: currency }));
        return;
      }
      const details = [r.supplier, r.number, r.totalMinor !== null ? formatMoney(r.totalMinor, currency, locale) : null].filter(Boolean).join(", ");
      setNote(details ? fillWords(words.readFrom, { details }) : words.readBare);
    });
  };

  return (
    <>
      <label className="flex max-w-md flex-col gap-1 font-medium">
        {words.file}
        <input name="bill" type="file" accept="application/pdf,image/jpeg,image/png,image/webp,image/heic" onChange={chosen} className={`${field} py-2`} />
      </label>
      {note && (
        <p role="status" aria-live="polite" className={reading ? "text-muted" : "font-medium"}>
          {note}
        </p>
      )}
      <div className="flex flex-wrap gap-3">
        <label className="flex min-w-56 flex-1 flex-col gap-1 font-medium">
          {words.supplier}
          <input name="supplier" required maxLength={120} value={supplier} onChange={(e) => setSupplier(e.target.value)} className={field} />
        </label>
        <label className="flex w-48 flex-col gap-1 font-medium">
          {words.number}
          <input name="number" maxLength={60} value={number} onChange={(e) => setNumber(e.target.value)} className={field} />
        </label>
      </div>
      <div className="flex flex-wrap gap-3">
        <label className="flex w-44 flex-col gap-1 font-medium">
          {words.issuedOn}
          <input type="date" name="issuedOn" required min={openedOn} value={issuedOn} onChange={(e) => setIssuedOn(e.target.value)} className={field} />
        </label>
        <label className="flex w-44 flex-col gap-1 font-medium">
          {words.dueOn}
          <input type="date" name="dueOn" value={dueOn} onChange={(e) => setDueOn(e.target.value)} className={field} />
        </label>
        <label className="flex w-56 flex-col gap-1 font-medium">
          {words.amount}
          <input name="amount" required inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} className={field} />
        </label>
      </div>
      <div className="flex flex-wrap gap-3">
        <label className="flex min-w-56 flex-1 flex-col gap-1 font-medium">
          {words.what}
          <select name="kind" value={kind} onChange={(e) => setKind(e.target.value)} className={field}>
            {(Object.keys(PURCHASE_KINDS) as PurchaseKind[]).map((k) => (
              <option key={k} value={k}>
                {words.kinds[k]}
              </option>
            ))}
          </select>
        </label>
        <label className="flex w-44 flex-col gap-1 font-medium">
          {words.vatRate}
          <select name="vat" value={vat} onChange={(e) => setVat(e.target.value)} className={field}>
            <option value="usual">{words.vatUsual}</option>
            {PURCHASE_VAT_RATES.map((rate) => (
              <option key={rate} value={rate}>
                {rate === 0 ? words.vatNone : `${rate} %`}
              </option>
            ))}
            <option value="abroad">{words.vatAbroad}</option>
          </select>
        </label>
      </div>
      <details>
        <summary className="w-fit cursor-pointer text-muted underline underline-offset-2">{words.more}</summary>
        <div className="mt-2 flex flex-col gap-3">
          <label className="flex max-w-md flex-col gap-1 font-medium">
            {words.organisationNumber}
            <input name="organisationNumber" maxLength={30} value={org} onChange={(e) => setOrg(e.target.value)} className={field} />
          </label>
          <label className="flex max-w-md flex-col gap-1 font-medium">
            {words.words}
            <input name="text" maxLength={200} className={field} />
          </label>
        </div>
      </details>
    </>
  );
}
