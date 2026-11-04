"use client";

import { useState, useTransition } from "react";

import { hint, primary } from "@/components/admin/data/ui";
import type { ShopPlugin } from "@/lib/woocommerce-mover";

import { useAdminText } from "../admin-text";
import { ShopifyDisconnect } from "./shopify-connect";

type Problem = "off" | "forbidden" | "disconnected";

/**
 * *Read more of your shop* (D446 step 2): before, the plugin's zip, the steps to put it on the owner's site, and *Connect the plugin*, which
 * opens the plugin's own page there; after, the plugins the shop runs and what becomes of each, and a way to stop it reading.
 */
export function WooMover({
  status,
  download,
  known,
  actions,
}: {
  status: { connected: false } | { connected: true; plugins: ShopPlugin[] | null };
  download: string;
  /** What becomes of each plugin Kaizena Flow knows by name. */
  known: Record<string, "read" | "here" | "none">;
  actions: { connect: () => Promise<{ ok: false; problem: Problem }>; stop: () => Promise<{ ok: boolean }> };
}) {
  const w = useAdminText("moving").woo.mover;
  const [problem, setProblem] = useState<Problem | null>(null);
  const [pending, start] = useTransition();
  return (
    <section aria-labelledby="woo-mover" className="flex flex-col gap-2">
      <h3 id="woo-mover" className="text-base font-medium">
        {w.title}
      </h3>
      <p className="text-sm">{w.text}</p>
      {!status.connected ? (
        <>
          <p className={hint}>{w.steps}</p>
          <div className="flex flex-wrap items-center gap-3">
            <a href={download} download className="text-sm underline underline-offset-2">
              {w.download}
            </a>
            <button
              type="button"
              disabled={pending}
              className={primary}
              onClick={() =>
                start(async () => {
                  setProblem(null);
                  const result = await actions.connect();
                  if (result && !result.ok) setProblem(result.problem);
                })
              }
            >
              {pending ? w.connecting : w.connect}
            </button>
          </div>
          {problem && (
            <p role="alert" className="text-sm text-danger-text">
              {w.problems[problem]}
            </p>
          )}
        </>
      ) : (
        <>
          <p className="text-sm">{w.connected}</p>
          {status.plugins === null ? (
            <p className={hint}>{w.unknown}</p>
          ) : (
            status.plugins.length > 0 && (
              <div className="flex flex-col gap-1">
                <h4 className="text-sm font-medium">{w.plugins}</h4>
                <ul className="flex flex-col gap-0.5 text-sm">
                  {status.plugins.map((p) => (
                    <li key={p.slug}>
                      {p.name || p.slug}
                      {known[p.slug] ? ` · ${w[known[p.slug]]}` : ""}
                    </li>
                  ))}
                </ul>
              </div>
            )
          )}
          <ShopifyDisconnect disconnect={actions.stop} ask={w.stop} label={w.stop} />
        </>
      )}
    </section>
  );
}
