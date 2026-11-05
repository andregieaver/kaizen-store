import "server-only";

import { cache } from "react";

import { sandboxFor } from "@/server/sandbox";

/** The sandbox a page of `/admin/try/{sandbox}` is drawn for, read once a request however many parts of the page ask (`sandboxFor()`). */
export const sandboxOf = cache((id: string) => sandboxFor(id));
