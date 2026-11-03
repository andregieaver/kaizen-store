import { z } from "zod";

/**
 * Shared parts of the published contracts (wave 14 unit A, D438): zod made into the JSON Schema an OpenAPI 3.1 document holds, path and
 * query parameters from a zod object, and canonical JSON (keys sorted) for the contract's hash. Pure.
 */

export type JsonSchema = { [key: string]: unknown };

/** The JSON Schema dialect OpenAPI 3.1 documents use, as `jsonSchemaDialect` names it. */
export const OPENAPI_DIALECT = "https://spec.openapis.org/oas/3.1/dialect/base";

/** Formats whose own pattern says nothing a reader needs: the format is kept, zod's long pattern is not. */
const FORMATS = new Set(["uuid", "date-time", "date", "email", "uri", "url"]);
const SAFE = Number.MAX_SAFE_INTEGER;

function tidy(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(tidy);
  if (!value || typeof value !== "object") return value;
  const out: JsonSchema = {};
  for (const [key, inner] of Object.entries(value as JsonSchema)) {
    if (key === "$schema") continue;
    if (key === "pattern" && FORMATS.has(String((value as JsonSchema).format))) continue;
    if ((key === "maximum" && inner === SAFE) || (key === "minimum" && inner === -SAFE)) continue;
    out[key] = tidy(inner);
  }
  return out;
}

/**
 * A zod schema as JSON Schema (draft 2020-12, as OpenAPI 3.1 takes it): what a caller sends or gets, defaults applied by the server shown as
 * `default` and never as required, extra properties allowed (an answer may gain fields within a version).
 */
export function jsonSchemaOf(schema: z.ZodType): JsonSchema {
  return tidy(z.toJSONSchema(schema, { io: "input", unrepresentable: "any" })) as JsonSchema;
}

export type OpenApiParameter = { name: string; in: "path" | "query" | "header"; required: boolean; description?: string; schema: JsonSchema };

/** The parameters a zod object describes: each property one parameter, its description lifted to the parameter. */
export function parametersOf(schema: z.ZodObject, where: "path" | "query"): OpenApiParameter[] {
  const json = jsonSchemaOf(schema);
  const properties = (json.properties ?? {}) as Record<string, JsonSchema>;
  const required = new Set((json.required ?? []) as string[]);
  return Object.entries(properties).map(([name, { description, ...rest }]) => ({
    name,
    in: where,
    required: where === "path" || required.has(name),
    ...(typeof description === "string" && { description }),
    schema: rest,
  }));
}

/** A path template's parameters in order: `/carts/{cart}/lines/{variantId}` gives cart and variantId. */
export const pathParams = (path: string): string[] => [...path.matchAll(/\{(\w+)\}/g)].map((m) => m[1]);

/** JSON with every object's keys sorted, so the same contract always writes the same text (and hash). */
export function canonicalJson(value: unknown): string {
  const sorted = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(sorted);
    if (!v || typeof v !== "object") return v;
    return Object.fromEntries(
      Object.keys(v as JsonSchema)
        .sort()
        .map((k) => [k, sorted((v as JsonSchema)[k])]),
    );
  };
  return JSON.stringify(sorted(value));
}

/** The error envelope every API answers a refusal in. */
export const errorEnvelope = (codes: readonly string[], description: string): JsonSchema => ({
  type: "object",
  description,
  properties: {
    error: {
      type: "object",
      properties: {
        code: { type: "string", enum: [...codes], description: "What went wrong, as a stable code to branch on." },
        message: { type: "string", description: "What went wrong, in a sentence for a person." },
      },
      required: ["code", "message"],
    },
  },
  required: ["error"],
});
