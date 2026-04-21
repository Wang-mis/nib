import { describe, expect, test } from "bun:test";
import {
  ToolNotFoundError,
  ToolValidationError,
} from "../../src/tools/types.ts";
import {
  ToolRegistry,
  defaultRegistry,
} from "../../src/tools/registry.ts";
import type { Tool } from "../../src/tools/types.ts";
import { z } from "zod";

const echoTool: Tool<{ message: string }, { echoed: string }> = {
  name: "echo",
  description: "echo input",
  schema: z.object({ message: z.string() }).strict(),
  execute: async (input) => ({ echoed: input.message }),
};

describe("ToolRegistry", () => {
  test("defaultRegistry contains the 4 sprint-1 tools", () => {
    const reg = defaultRegistry();
    const names = reg.list().map((t) => t.name).sort();
    expect(names).toEqual(["bash", "glob", "read_file", "write_file"]);
  });

  test("rejects duplicate tool names", () => {
    expect(() =>
      ToolRegistry.from([echoTool, echoTool]),
    ).toThrow(/duplicate/);
  });

  test("withTool returns a new registry (immutable)", () => {
    const a = ToolRegistry.from([]);
    const b = a.withTool(echoTool);
    expect(a.list().length).toBe(0);
    expect(b.list().length).toBe(1);
  });

  test("dispatch executes a registered tool with valid input", async () => {
    const reg = ToolRegistry.from([echoTool]);
    const out = await reg.dispatch(
      "echo",
      { message: "hi" },
      { cwd: process.cwd() },
    );
    expect(out).toEqual({ echoed: "hi" });
  });

  test("dispatch throws ToolNotFoundError for unknown tool", async () => {
    const reg = ToolRegistry.from([]);
    await expect(
      reg.dispatch("nope", {}, { cwd: process.cwd() }),
    ).rejects.toBeInstanceOf(ToolNotFoundError);
  });

  test("dispatch throws ToolValidationError for invalid input", async () => {
    const reg = ToolRegistry.from([echoTool]);
    await expect(
      reg.dispatch("echo", { message: 123 }, { cwd: process.cwd() }),
    ).rejects.toBeInstanceOf(ToolValidationError);
  });
});
