// Zod → JSON Schema for Anthropic tool input_schema.
// Anthropic's API rejects the `$schema` and (in some cases) `additionalProperties`
// metadata at the root, so we strip them.
import { z } from "zod";

export interface JSONSchemaObject {
  type: "object";
  properties?: Record<string, unknown>;
  required?: string[];
  [key: string]: unknown;
}

export function zodToJSONSchema(schema: z.ZodType<unknown>): JSONSchemaObject {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const raw = z.toJSONSchema(schema as any) as Record<string, unknown>;
  const { $schema: _meta, ...rest } = raw;
  void _meta;
  if (rest.type !== "object") {
    return { type: "object", properties: {}, ...rest };
  }
  return rest as JSONSchemaObject;
}
