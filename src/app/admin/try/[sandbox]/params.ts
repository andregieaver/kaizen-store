import "server-only";

import { notFound } from "next/navigation";
import { z } from "zod";

import { SANDBOX_KINDS, isSandboxSegment, type SandboxKind } from "@/lib/sandbox";
import type { Sandbox } from "@/server/sandbox";

import { offers, sandboxOf } from "./sandbox";

type Params = Promise<{ sandbox: string; kind: string }>;

/** The sandbox and the kind of page an address names, or a 404 for a kind the sandbox does not offer. */
export async function sandboxAndKind(params: Params): Promise<{ sandbox: Sandbox | null; kind: SandboxKind }> {
  const { sandbox: id, kind: segment } = await params;
  if (!isSandboxSegment(segment)) notFound();
  const sandbox = await sandboxOf(id);
  const kind = SANDBOX_KINDS[segment];
  if (sandbox && !offers(sandbox, kind)) notFound();
  return { sandbox, kind };
}

export const isPageId = (value: string) => z.uuid().safeParse(value).success;
