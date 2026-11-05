import "server-only";

import { cache } from "react";

import type { SandboxKind } from "@/lib/sandbox";
import { requirementMet } from "@/lib/store-features";
import { sandboxFor, type Sandbox } from "@/server/sandbox";

/** The sandbox a page of `/admin/try/{sandbox}` is drawn for, read once a request however many parts of the page ask (`sandboxFor()`). */
export const sandboxOf = cache((id: string) => sandboxFor(id));

/** Whether the sandbox's store offers a kind: product layouts are part of the online shop (D178 step 5), as in a store. */
export const offers = (sandbox: Sandbox, kind: SandboxKind) => kind !== "product_layout" || requirementMet(sandbox.store, "shop");
