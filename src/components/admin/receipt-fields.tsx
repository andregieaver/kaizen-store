"use client";

import { useState, useTransition, type ChangeEvent } from "react";

import { field } from "@/components/admin/data/ui";
import { fillWords } from "@/lib/admin-fill";
import { formatMoney } from "@/lib/money";
import { PURCHASE_KINDS, PURCHASE_VAT_RATES, READABLE_RECEIPTS, type PurchaseKind } from "@/lib/purchases";

import type { ReceiptReadResult } from "@/app/admin/(gated)/[store]/settings/books/actions";

export type ReceiptFieldWords = {
  what: string;
  vatRate: string;
  vatUsual: string;
  vatNone: string;
  vatAbroad: string;
  words: string;
  receiptFile: string;
  kinds: Record<string, string>;
  reading: string;
  readFrom: string;
  readBare: string;
  differs: string;
  unread: string;
};

/**
 * A purchase's fields under its bank line (D490, D491): what it was, its VAT, the owner's own words and the receipt. When the owner chooses a
 * photo, the store's model reads it (`read`, `readReceiptAction()`) and fills what it was, the VAT and the supplier, and says whether the
 * receipt's total is the bank's amount; the owner changes what they like and posts with the form's button. Nothing is posted here.
 */
export function ReceiptFields({
  lineId,
  defaultText,
  bankMinor,
  currency,
  locale,
  words,
  read,
}: {
  lineId: string;
  defaultText: string;
  bankMinor: number;
  currency: string;
  locale: string;
  words: ReceiptFieldWords;
  read: (form: FormData) => Promise<ReceiptReadResult>;
}) {
  const [kind, setKind] = useState<string>("office");
  const [vat, setVat] = useState<string>("usual");
  const [text, setText] = useState(defaultText);
  const [note, setNote] = useState<string | null>(null);
  const [reading, start] = useTransition();
  const money = (minor: number) => formatMoney(minor, currency, locale);

  const chosen = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    setNote(null);
    if (!file || !(READABLE_RECEIPTS as readonly string[]).includes(file.type)) return;
    start(async () => {
      setNote(words.reading);
      const form = new FormData();
      form.set("line", lineId);
      form.set("receipt", file);
      const result = await read(form).catch(() => null);
      if (!result || !result.ok) {
        setNote(result?.reason === "unread" ? words.unread : null);
        return;
      }
      if (result.kind) setKind(result.kind);
      if (result.abroad) setVat("abroad");
      else if (result.vatRate !== null) setVat(String(result.vatRate));
      if (result.supplier) setText(result.supplier);
      if (result.agrees === "differs" && result.totalMinor !== null) {
        setNote(fillWords(words.differs, { total: money(result.totalMinor), bank: money(Math.abs(bankMinor)) }));
        return;
      }
      const details = [result.supplier, result.totalMinor !== null ? money(result.totalMinor) : null].filter(Boolean).join(", ");
      setNote(details ? fillWords(words.readFrom, { details }) : words.readBare);
    });
  };

  return (
    <>
      <label className="flex max-w-md flex-col gap-1 font-medium">
        {words.receiptFile}
        <input name={`receipt-${lineId}`} type="file" accept="image/jpeg,image/png,image/webp,image/heic,application/pdf" onChange={chosen} className={`${field} py-2`} />
      </label>
      {note && (
        <p role="status" aria-live="polite" className={reading ? "text-muted" : "font-medium"}>
          {note}
        </p>
      )}
      <div className="flex flex-wrap gap-3">
        <label className="flex min-w-56 flex-1 flex-col gap-1 font-medium">
          {words.what}
          <select name={`kind-${lineId}`} value={kind} onChange={(e) => setKind(e.target.value)} className={field}>
            {(Object.keys(PURCHASE_KINDS) as PurchaseKind[]).map((k) => (
              <option key={k} value={k}>
                {words.kinds[k]}
              </option>
            ))}
          </select>
        </label>
        <label className="flex w-44 flex-col gap-1 font-medium">
          {words.vatRate}
          <select name={`vat-${lineId}`} value={vat} onChange={(e) => setVat(e.target.value)} className={field}>
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
      <label className="flex max-w-md flex-col gap-1 font-medium">
        {words.words}
        <input name={`text-${lineId}`} maxLength={200} value={text} onChange={(e) => setText(e.target.value)} className={field} />
      </label>
    </>
  );
}
