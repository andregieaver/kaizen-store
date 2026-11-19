"use client";

import { useState, useTransition } from "react";

import { fillWords } from "@/lib/admin-fill";

import { useAdminText } from "./admin-text";
import { Button } from "./ui";
import { ConfirmButton } from "./ui/confirm-button";

type Answer = { ok: true } | { ok: false; message: string };
type AsyncAnswer = Promise<Answer>;

/** Makes a storefront token (D362) for one of the store's countries. Public by design, so the list shows it in full. */
export function MakeStorefrontToken({ markets, make }: { markets: { slug: string; name: string }[]; make: (form: FormData) => AsyncAnswer }) {
  const w = useAdminText("notifications").storefrontTokens;
  const [pending, start] = useTransition();
  const [problem, setProblem] = useState<string | null>(null);
  const [key, setKey] = useState(0);
  const control = "min-h-10 rounded-md border border-line bg-card px-3 font-normal";
  return (
    <form
      key={key}
      aria-busy={pending}
      className="flex flex-wrap items-end gap-3"
      action={(form) =>
        start(async () => {
          const answer = await make(form);
          if (answer.ok) {
            setProblem(null);
            setKey((k) => k + 1);
          } else setProblem(answer.message);
        })
      }
    >
      <label className="flex min-w-48 flex-1 flex-col gap-1 text-sm font-medium">
        {w.name}
        <input name="name" required maxLength={60} placeholder={w.namePlaceholder} className={control} />
      </label>
      <label className="flex flex-col gap-1 text-sm font-medium">
        {w.market}
        <select name="market" className={control} defaultValue={markets[0]?.slug}>
          {markets.map((m) => (
            <option key={m.slug} value={m.slug}>
              {m.name}
            </option>
          ))}
        </select>
      </label>
      <Button type="submit" kind="main" disabled={pending}>
        {pending ? w.making : w.make}
      </Button>
      {problem && (
        <p role="alert" className="w-full text-sm text-danger-text">
          {problem}
        </p>
      )}
    </form>
  );
}

/** Revokes a storefront token, after asking in the admin's dialog. */
export function RevokeStorefrontToken({ name, revoke }: { name: string; revoke: () => AsyncAnswer }) {
  const w = useAdminText("notifications").storefrontTokens;
  return (
    <ConfirmButton kind="quiet" size="dense" question={fillWords(w.revokeQuestion, { name })} confirm={w.revoke} action={revoke}>
      {w.revoke}
    </ConfirmButton>
  );
}
