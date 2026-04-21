import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { globTool } from "../../src/tools/glob.ts";

describe("glob tool", () => {
  let dir = "";

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "nib-glob-"));
    await mkdir(join(dir, "src"), { recursive: true });
    await mkdir(join(dir, "src", "nested"), { recursive: true });
    await writeFile(join(dir, "src", "a.ts"), "");
    await writeFile(join(dir, "src", "b.ts"), "");
    await writeFile(join(dir, "src", "nested", "c.ts"), "");
    await writeFile(join(dir, "src", "d.txt"), "");
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  test("schema rejects empty pattern", () => {
    const result = globTool.schema.safeParse({ pattern: "" });
    expect(result.success).toBe(false);
  });

  test("matches recursive ts files", async () => {
    const out = await globTool.execute(
      { pattern: "**/*.ts" },
      { cwd: dir },
    );
    expect(out.matches.length).toBe(3);
    expect(out.matches.some((m) => m.endsWith("a.ts"))).toBe(true);
    expect(out.matches.some((m) => m.endsWith("c.ts"))).toBe(true);
  });

  test("respects limit and reports truncated", async () => {
    const out = await globTool.execute(
      { pattern: "**/*.ts", limit: 2 },
      { cwd: dir },
    );
    expect(out.matches.length).toBe(2);
    expect(out.truncated).toBe(true);
  });

  test("returns empty matches for no hits", async () => {
    const out = await globTool.execute(
      { pattern: "**/*.rs" },
      { cwd: dir },
    );
    expect(out.matches.length).toBe(0);
    expect(out.truncated).toBe(false);
  });

  test("results are sorted", async () => {
    const out = await globTool.execute(
      { pattern: "src/*.ts" },
      { cwd: dir },
    );
    const sorted = [...out.matches].sort();
    expect(out.matches).toEqual(sorted);
  });
});
