import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";

import { countryName } from "@/lib/drop-shipping";
import { passportWords, recycledShare } from "@/lib/product-passport";
import { publicPassport } from "@/server/product-passports";

export const metadata: Metadata = { title: "Product passport" };

type Props = PageProps<"/passport/[id]">;

/**
 * A product's Digital Product Passport (D554), as anyone who scans the code on the product reads it: the product, its identifiers, who made it
 * and who answers for it in the EU, then the passport's facts. Only a published passport; read per request. Everything is the store's text,
 * shown as text.
 */
export default function PassportPage({ params }: Props) {
  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-6 px-4 py-10">
      <Suspense fallback={<div className="h-40 animate-pulse rounded-lg bg-surface" />}>
        <Body params={params} />
      </Suspense>
    </main>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-1 border-t border-line pt-4">
      <h2 className="text-lg font-medium">{title}</h2>
      {children}
    </section>
  );
}

async function Body({ params }: Pick<Props, "params">) {
  await connection();
  const { id } = await params;
  const p = await publicPassport(id);
  if (!p) notFound();
  const w = passportWords(p.lang);
  const d = p.passport;
  const share = recycledShare(d);
  const who = (o: NonNullable<typeof p.manufacturer>) => (
    <p className="whitespace-pre-line">{[o.name, o.address, o.contact].filter(Boolean).join("\n")}</p>
  );
  return (
    <article lang={p.lang} className="flex flex-col gap-4">
      <header className="flex flex-col gap-1">
        <p className="text-sm text-muted">{w.title}</p>
        <h1 className="text-3xl tracking-tight">{p.title}</h1>
        <p className="text-muted">{w.intro}</p>
      </header>
      {p.identifiers.length > 0 && (
        <Section title={w.identifiers}>
          <ul>
            {p.identifiers.map((i, n) => (
              <li key={n} className="tabular-nums">
                {[i.gtin ? `GTIN ${i.gtin}` : null, i.sku ? `SKU ${i.sku}` : null].filter(Boolean).join(" · ")}
              </li>
            ))}
          </ul>
        </Section>
      )}
      {p.manufacturer && <Section title={w.manufacturer}>{who(p.manufacturer)}</Section>}
      {p.responsible && <Section title={w.responsible}>{who(p.responsible)}</Section>}
      {d.materials.length > 0 && (
        <Section title={w.materials}>
          <ul>
            {d.materials.map((m, n) => (
              <li key={n}>
                {m.name}: {m.percent} %{m.recycledPercent > 0 ? ` (${m.recycledPercent} % ${w.recycled})` : ""}
              </li>
            ))}
          </ul>
          {share !== null && share > 0 && (
            <p className="text-sm text-muted">
              {w.recycledTotal}: {share} %
            </p>
          )}
        </Section>
      )}
      {d.originCountry && <Section title={w.origin}><p>{countryName(d.originCountry)}</p></Section>}
      {d.substances && <Section title={w.substances}><p className="whitespace-pre-line">{d.substances}</p></Section>}
      {d.care && <Section title={w.care}><p className="whitespace-pre-line">{d.care}</p></Section>}
      {(d.repair || d.sparePartsYears !== null) && (
        <Section title={w.repair}>
          {d.repair && <p className="whitespace-pre-line">{d.repair}</p>}
          {d.sparePartsYears !== null && d.sparePartsYears > 0 && (
            <p>
              {w.spareParts} {w.years(d.sparePartsYears)}
            </p>
          )}
        </Section>
      )}
      {d.durabilityYears !== null && d.durabilityYears > 0 && <Section title={w.durability}><p>{w.years(d.durabilityYears)}</p></Section>}
      {d.endOfLife && <Section title={w.endOfLife}><p className="whitespace-pre-line">{d.endOfLife}</p></Section>}
      {d.certifications.length > 0 && (
        <Section title={w.certifications}>
          <ul>
            {d.certifications.map((c, n) => (
              <li key={n}>
                {c.url ? (
                  <a href={c.url} rel="noopener noreferrer nofollow" className="underline underline-offset-2">
                    {c.name}
                  </a>
                ) : (
                  c.name
                )}
                {c.number ? ` (${c.number})` : ""}
              </li>
            ))}
          </ul>
        </Section>
      )}
      {d.carbon && (
        <Section title={w.carbon}>
          <p>
            {d.carbon.kgCo2e} kg CO₂e · {d.carbon.method}
          </p>
        </Section>
      )}
      {d.documents.length > 0 && (
        <Section title={w.documents}>
          <ul>
            {d.documents.map((doc, n) => (
              <li key={n}>
                <a href={doc.url} rel="noopener noreferrer nofollow" className="underline underline-offset-2">
                  {doc.title}
                </a>
              </li>
            ))}
          </ul>
        </Section>
      )}
      <Section title={w.seller}>
        <p className="whitespace-pre-line">{[p.storeName, p.storeAddress].filter(Boolean).join("\n")}</p>
      </Section>
      <footer className="flex flex-col gap-1 border-t border-line pt-4 text-sm text-muted">
        <p>
          {w.updated}: {new Date(p.updatedAt).toISOString().slice(0, 10)}
        </p>
        <a href={`/passport/${p.id}/json`} className="underline underline-offset-2">
          {w.json}
        </a>
      </footer>
    </article>
  );
}
