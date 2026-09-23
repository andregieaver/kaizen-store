import Link from "next/link";
import { market as marketParam } from "next/root-params";

import { getMarket } from "@/lib/markets";

const text = {
  no: { title: "Siden finnes ikke.", back: "Til forsiden" },
  se: { title: "Sidan finns inte.", back: "Till startsidan" },
  dk: { title: "Siden findes ikke.", back: "Til forsiden" },
} as const;

export default async function MarketNotFound() {
  const market = getMarket((await marketParam()) ?? "no") ?? getMarket("no")!;
  const { title, back } = text[market.slug];
  return (
    <div className="flex flex-col gap-4 py-16">
      <h1 className="text-2xl font-semibold">{title}</h1>
      <Link href={`/${market.slug}`} className="underline">
        {back}
      </Link>
    </div>
  );
}
