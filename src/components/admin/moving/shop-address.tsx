"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";

import { hint, primary, secondary } from "@/components/admin/data/ui";
import { fillWords } from "@/lib/admin-fill";
import type { AddressView } from "@/server/shopify-address";

import { useAdminText } from "../admin-text";

export type AddressActions = {
  start: () => Promise<{ ok: boolean; problems?: string[] }>;
  check: () => Promise<{ done: boolean }>;
};

/**
 * Move day, the address (D445 step 7b): the Shopify shop's own address, one press to point it here, then only the way that fits where its DNS
 * is kept (nothing, one press at the provider, or the records with steps in the provider's own words and a Copy button each). While it waits,
 * the page checks every 30 seconds and says *Leads here* by itself.
 */
export function ShopAddress({ view, actions, hrefs }: { view: AddressView; actions: AddressActions; hrefs: { domains: string; moveIn: string } }) {
  const w = useAdminText("moving").address;
  const router = useRouter();
  const [pending, start] = useTransition();
  const [problems, setProblems] = useState<string[]>([]);
  const waiting = view.hosts.some((h) => h.status === "waiting");

  useEffect(() => {
    if (!waiting) return;
    let stop = false;
    const tick = async () => {
      if (stop) return;
      const result = await actions.check().catch(() => ({ done: false }));
      router.refresh();
      if (!stop && !result.done) timer = setTimeout(tick, 30_000);
    };
    let timer = setTimeout(tick, 30_000);
    return () => {
      stop = true;
      clearTimeout(timer);
    };
  }, [waiting, actions, router]);

  if (!view.primary) {
    return (
      <section aria-labelledby="shop-address" className="flex flex-col gap-2">
        <p className="text-sm">
          {w.none}{" "}
          <Link href={hrefs.domains} className="underline underline-offset-2">
            {w.noneLink}
          </Link>
        </p>
      </section>
    );
  }
  const domain = view.primary;
  const apex = view.apex ?? domain;

  if (view.done) {
    return (
      <section aria-labelledby="shop-address" className="flex flex-col gap-2">
        <h3 id="shop-address" className="text-base font-medium">
          {fillWords(w.done, { domain })}
        </h3>
        <p className="text-sm">{w.doneText}</p>
      </section>
    );
  }

  const press = () =>
    start(async () => {
      const result = await actions.start();
      setProblems(result.ok ? [] : (result.problems ?? []));
      router.refresh();
    });

  return (
    <section aria-labelledby="shop-address" className="flex flex-col gap-3">
      <h3 id="shop-address" className="text-base font-medium">
        {fillWords(w.title, { domain })}
      </h3>
      {!view.configured && <p className={hint}>{w.off}</p>}
      <ul className="flex flex-col gap-1 text-sm" aria-live="polite">
        {view.hosts.map((h) => (
          <li key={h.hostname}>
            <span className="font-medium">{h.hostname}</span>: {w.status[h.status]}
            {h.status !== "active" && h.atShopify && h.status === "waiting" ? ` · ${w.stillShopify}` : ""}
          </li>
        ))}
      </ul>
      {view.hosts.some((h) => h.status === "not_added") ? (
        <div className="flex flex-col gap-2">
          <p className="text-sm">{fillWords(w.text, { domain })}</p>
          <div>
            <button type="button" disabled={pending || !view.configured} className={primary} onClick={press}>
              {pending ? w.starting : w.start}
            </button>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {view.hosts
            .filter((h) => h.connectUrl)
            .map((h) => (
              <div key={h.hostname}>
                <a href={h.connectUrl!} className={primary}>
                  {fillWords(w.connect, { provider: h.provider ?? "" })}
                </a>
              </div>
            ))}
          <p className="text-sm">{fillWords(w.steps[view.dnsHost], { apex })}</p>
          <Records hosts={view.hosts} />
          <p className={hint}>{w.replace}</p>
          <p className={hint}>{w.checking}</p>
        </div>
      )}
      {problems.length > 0 && (
        <ul className={hint} role="alert">
          {problems.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      )}
      {view.dnsHost !== "kaizena" && (
        <Link href={hrefs.moveIn} className="w-fit text-xs underline underline-offset-2">
          {w.lookAfter}
        </Link>
      )}
    </section>
  );
}

/** The records still to make, each value with its own Copy button; one already in place is marked done. */
function Records({ hosts }: { hosts: AddressView["hosts"] }) {
  const w = useAdminText("moving").address;
  const rows = hosts.flatMap((h) => h.records.map((r) => ({ ...r, key: `${h.hostname}|${r.type}|${r.name}|${r.value}` })));
  if (rows.length === 0) return null;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="text-xs text-muted">
            <th className="py-1 pr-3 font-normal">{w.columns.type}</th>
            <th className="py-1 pr-3 font-normal">{w.columns.name}</th>
            <th className="py-1 pr-3 font-normal">{w.columns.value}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key} className="border-t border-line align-top">
              <td className="py-2 pr-3">{r.type}</td>
              <td className="py-2 pr-3 break-all">
                {r.name}
                {r.done ? " ✓" : ""}
              </td>
              <td className="py-2 pr-3">
                <span className="flex flex-wrap items-center gap-2">
                  <code className="break-all">{r.value}</code>
                  <CopyValue value={r.value} />
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function CopyValue({ value }: { value: string }) {
  const w = useAdminText("moving").address;
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className={secondary}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setDone(true);
          window.setTimeout(() => setDone(false), 2500);
        } catch {
          setDone(false);
        }
      }}
    >
      {done ? w.copied : w.copy}
    </button>
  );
}
