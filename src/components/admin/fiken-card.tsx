import Link from "next/link";

import { countWords, fillWords } from "@/lib/admin-fill";
import type { AdminLang } from "@/lib/admin-lang";
import { adminText } from "@/lib/admin-text";
import type { FikenConnection } from "@/server/fiken";

const card = "rounded-lg border border-line bg-card p-5";

/**
 * Fiken on Work's settings (D460): where the invoices go once issued, for a store that keeps its books in Fiken, and the way to its page.
 * Shown instead of Tripletex's card, as a store sends to one system at a time.
 */
export function FikenAccountingCard({ lang, storeSlug, connection, needYou }: { lang: AdminLang; storeSlug: string; connection: FikenConnection; needYou: number }) {
  const w = adminText(lang, "fiken");
  const status =
    connection.state === "on" && connection.company
      ? fillWords(w.workCard.text, { company: connection.company.name })
      : `Fiken · ${w.listStatus[connection.state]}`;
  return (
    <section aria-labelledby="fiken-accounting" className={card}>
      <h2 id="fiken-accounting" className="mb-1 text-title text-ink">
        {w.workCard.title}
      </h2>
      <p className="mb-3 text-sm text-muted">
        {status}
        {connection.state === "on" && needYou > 0 && <> {countWords(needYou, w.workCard.needYou)}</>}
      </p>
      <Link href={`/admin/${storeSlug}/integrations/fiken`} className="inline-flex min-h-10 items-center rounded-pill border border-edge px-4 text-sm font-medium hover:bg-sunken">
        {w.workCard.manage}
      </Link>
    </section>
  );
}
