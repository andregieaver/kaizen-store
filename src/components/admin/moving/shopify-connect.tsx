"use client";

import { useRouter } from "next/navigation";
import { useId, useState, useTransition } from "react";

import { field, hint, primary, secondary } from "@/components/admin/data/ui";

import { useAdminText } from "../admin-text";

type Problem = "address" | "not_shopify" | "unreachable" | "off" | "forbidden" | "other_shop";
type WooProblem = "address" | "not_wordpress" | "not_woocommerce" | "unreachable" | "off" | "forbidden" | "other_shop";

/**
 * *Connect Shopify* (D445 step 2), or *Connect WooCommerce* (D446 step 1, `kind`): the shop's address and one button. On success the action
 * sends the browser to the platform's own page, so this only ever shows a problem.
 */
export function ShopifyConnectForm(
  props:
    | { kind?: "shopify"; connect: (address: string) => Promise<{ ok: false; problem: Problem }>; initial?: string }
    | { kind: "woocommerce"; connect: (address: string) => Promise<{ ok: false; problem: WooProblem }>; initial?: string },
) {
  const { connect, initial = "" } = props;
  const all = useAdminText("moving");
  const w = props.kind === "woocommerce" ? all.woo.connect : all.connect;
  const problems: Record<string, string> = props.kind === "woocommerce" ? all.woo.problems : all.problems;
  const id = useId();
  const [address, setAddress] = useState(initial);
  const [problem, setProblem] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <form
      className="flex flex-col gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (!address.trim()) return;
        start(async () => {
          setProblem(null);
          const result = await connect(address);
          if (result && !result.ok) setProblem(result.problem);
        });
      }}
    >
      <label htmlFor={`${id}-shop`} className="text-sm font-medium">
        {w.label}
      </label>
      <div className="flex flex-wrap gap-2">
        <input
          id={`${id}-shop`}
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          placeholder={w.placeholder}
          inputMode="url"
          autoComplete="url"
          spellCheck={false}
          aria-describedby={`${id}-help`}
          className={`${field} min-w-56 flex-1`}
        />
        <button type="submit" disabled={pending || address.trim() === ""} className={primary}>
          {pending ? w.working : w.button}
        </button>
      </div>
      <p id={`${id}-help`} className={hint}>
        {w.help}
      </p>
      {problem && (
        <p role="alert" className="text-sm text-danger-text">
          {problems[problem]}
        </p>
      )}
    </form>
  );
}

/** *Check your old links*: one press that reads the connected shop's sitemap and opens the old shop's links. */
export function CheckOldLinks({ check }: { check: () => Promise<{ ok: false }> }) {
  const w = useAdminText("moving");
  const [failed, setFailed] = useState(false);
  const [pending, start] = useTransition();
  return (
    <div className="flex flex-col gap-2">
      <div>
        <button
          type="button"
          disabled={pending}
          className={primary}
          onClick={() =>
            start(async () => {
              setFailed(false);
              const result = await check();
              if (result && !result.ok) setFailed(true);
            })
          }
        >
          {pending ? w.connected.nextWorking : w.connected.next}
        </button>
      </div>
      <p className={hint}>{w.connected.nextHelp}</p>
      {failed && (
        <p role="alert" className="text-sm text-danger-text">
          {w.oldShopProblem}
        </p>
      )}
    </div>
  );
}

/** *Disconnect*, behind a question (`ask`: the question's own words, WooCommerce's). */
export function ShopifyDisconnect({ disconnect, ask }: { disconnect: () => Promise<{ ok: boolean }>; ask?: string }) {
  const w = useAdminText("moving").connected;
  const router = useRouter();
  const [asking, setAsking] = useState(false);
  const [pending, start] = useTransition();
  if (!asking)
    return (
      <button type="button" onClick={() => setAsking(true)} className="text-sm underline underline-offset-2">
        {w.disconnect}
      </button>
    );
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm" role="group" aria-label={w.disconnect}>
      <span>{ask ?? w.disconnectAsk}</span>
      <button
        type="button"
        disabled={pending}
        className={secondary}
        onClick={() =>
          start(async () => {
            await disconnect();
            setAsking(false);
            router.refresh();
          })
        }
      >
        {w.disconnect}
      </button>
      <button type="button" onClick={() => setAsking(false)} className="underline underline-offset-2">
        {w.cancel}
      </button>
    </div>
  );
}
