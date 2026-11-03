"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { hint, primary, secondary } from "@/components/admin/data/ui";
import { OperatorPicker } from "@/components/admin/operator-picker";
import { countWords, fillWords } from "@/lib/admin-fill";
import type { CountryOption } from "@/lib/iso-countries";
import type { OperatorChoice } from "@/lib/product-input";
import type { Operator } from "@/server/products";
import type { MakerSaved } from "@/server/shopify-makers";

import { useAdminText } from "../admin-text";

export type MakerRow = { vendor: string; count: number; toPublish: number };

type Save = (input: { vendor: string; manufacturer: OperatorChoice; responsible: OperatorChoice }) => Promise<MakerSaved>;

const BLANK = { name: "", postalAddress: "", electronicAddress: "", country: "" };

/**
 * *Who makes your products?* (D445 step 6): one question per Shopify vendor, never one per product. *Yes* opens the vendor as a new company with
 * its name filled in; *No, someone else* opens a blank one (or one of the store's). A maker outside the EU asks for the EU responsible person
 * too. Saving names the maker on every product of that vendor still without one, and publishes those that were on sale in Shopify.
 */
export function ShopMakers({ rows, operators, countries, euCountries, save, bulkHref }: { rows: MakerRow[]; operators: Operator[]; countries: CountryOption[]; euCountries: string[]; save: Save; bulkHref: string }) {
  const w = useAdminText("moving").makers;
  const [said, setSaid] = useState<string | null>(null);
  if (rows.length === 0 && !said) return null;
  return (
    <section aria-labelledby="shop-makers" className="flex flex-col gap-3">
      <h3 id="shop-makers" className="text-base font-medium">
        {w.title}
      </h3>
      <p className="text-sm">{w.text}</p>
      {said && (
        <p className="text-sm" role="status">
          {said}{" "}
          <Link href={bulkHref} className="underline underline-offset-2">
            {w.undo}
          </Link>
        </p>
      )}
      <ul className="flex flex-col gap-3">
        {rows.map((row) => (
          <MakerItem key={row.vendor} row={row} operators={operators} countries={countries} euCountries={euCountries} save={save} onSaved={setSaid} />
        ))}
      </ul>
    </section>
  );
}

function MakerItem({ row, operators, countries, euCountries, save, onSaved }: { row: MakerRow; operators: Operator[]; countries: CountryOption[]; euCountries: string[]; save: Save; onSaved: (text: string) => void }) {
  const w = useAdminText("moving").makers;
  const router = useRouter();
  const [pending, start] = useTransition();
  const [maker, setMaker] = useState<OperatorChoice | null>(null);
  const [responsible, setResponsible] = useState<OperatorChoice>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const name = row.vendor || w.noVendor;
  const countryOf = (choice: OperatorChoice): string => (choice === null ? "" : "id" in choice ? (operators.find((o) => o.id === choice.id)?.country ?? "") : choice.new.country);
  const makerCountry = maker ? countryOf(maker) : "";
  const outsideEu = makerCountry !== "" && !euCountries.includes(makerCountry);

  const yes = () => {
    const same = operators.find((o) => o.name.trim().toLowerCase() === row.vendor.trim().toLowerCase());
    setMaker(same ? { id: same.id } : { new: { ...BLANK, name: row.vendor } });
  };
  const press = () =>
    start(async () => {
      setProblem(null);
      const result = await save({ vendor: row.vendor, manufacturer: maker, responsible: outsideEu ? responsible : null });
      if (!result.ok) {
        setProblem(w.problems[result.problem]);
        return;
      }
      const lines = [countWords(result.named, w.saved)];
      if (result.published > 0) lines.push(countWords(result.published, w.published));
      if (result.notPublished > 0) lines.push(countWords(result.notPublished, w.notPublished));
      onSaved(lines.join(" "));
      setMaker(null);
      router.refresh();
    });

  return (
    <li className="flex flex-col gap-2 rounded-md border border-line p-3">
      <p className="text-sm">
        <span className="font-medium">{name}</span> · {countWords(row.count, w.products)}
      </p>
      {maker === null ? (
        <div className="flex flex-wrap items-center gap-2">
          {row.vendor && <span className="text-sm">{fillWords(w.isMaker, { vendor: row.vendor })}</span>}
          {row.vendor && (
            <button type="button" className={primary} onClick={yes}>
              {w.yes}
            </button>
          )}
          <button type="button" className={secondary} onClick={() => setMaker(operators[0] ? { id: operators[0].id } : { new: BLANK })}>
            {row.vendor ? w.someoneElse : w.choose}
          </button>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <OperatorPicker legend={w.maker} choice={maker} operators={operators} countries={countries} onChange={(c) => setMaker(c ?? { new: BLANK })} required />
          {outsideEu && <OperatorPicker legend={w.responsible} note={w.responsibleNote} choice={responsible} operators={operators} countries={countries} onChange={setResponsible} />}
          {problem && (
            <p className={hint} role="alert">
              {problem}
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <button type="button" disabled={pending} className={primary} onClick={press}>
              {pending ? w.saving : countWords(row.count, w.save)}
            </button>
            <button type="button" disabled={pending} className={secondary} onClick={() => setMaker(null)}>
              {w.cancel}
            </button>
          </div>
          {row.toPublish > 0 && <p className={hint}>{countWords(row.toPublish, w.willPublish)}</p>}
        </div>
      )}
    </li>
  );
}
