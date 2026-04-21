import { describe, expect, test } from "bun:test";
import { z } from "zod";
import { zodToJSONSchema } from "../../src/agent/schema.ts";

describe("zodToJSONSchema", () => {
  test("strict object → object schema with required and additionalProperties:false", () => {
    const schema = z.object({ path: z.string(), n: z.number().optional() }).strict();
    const json = zodToJSONSchema(schema);
    expect(json.type).toBe("object");
    expect(json.required).toEqual(["path"]);
    expect((json as Record<string, unknown>)["additionalProperties"]).toBe(false);
  });

  test("strips $schema metadata for Anthropic compatibility", () => {
    const schema = z.object({ x: z.string() });
    const json = zodToJSONSchema(schema);
    expect((json as Record<string, unknown>)["$schema"]).toBeUndefined();
  });

  test("preserves nested properties", () => {
    const schema = z.object({ count: z.number().int().min(1).max(10) });
    const json = zodToJSONSchema(schema);
    const props = json.properties as Record<string, Record<string, unknown>>;
    expect(props["count"]?.["type"]).toBe("integer");
  });
});
