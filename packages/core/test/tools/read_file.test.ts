import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readFileTool } from "../../src/tools/read_file.ts";

describe("read_file tool", () => {
  let dir = "";

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "nib-read-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  test("schema rejects empty path", () => {
    const result = readFileTool.schema.safeParse({ path: "" });
    expect(result.success).toBe(false);
  });

  test("schema rejects unknown fields", () => {
    const result = readFileTool.schema.safeParse({ path: "x", junk: 1 });
    expect(result.success).toBe(false);
  });

  test("reads full file content", async () => {
    const file = join(dir, "hello.txt");
    await writeFile(file, "line1\nline2\nline3");
    const out = await readFileTool.execute(
      { path: "hello.txt" },
      { cwd: dir },
    );
    expect(out.content).toBe("line1\nline2\nline3");
    expect(out.totalLines).toBe(3);
    expect(out.truncated).toBe(false);
  });

  test("respects offset and limit", async () => {
    const file = join(dir, "many.txt");
    await writeFile(file, "a\nb\nc\nd\ne");
    const out = await readFileTool.execute(
      { path: "many.txt", offset: 1, limit: 2 },
      { cwd: dir },
    );
    expect(out.content).toBe("b\nc");
    expect(out.totalLines).toBe(5);
    expect(out.truncated).toBe(true);
  });

  test("throws on missing file", async () => {
    await expect(
      readFileTool.execute({ path: "nope.txt" }, { cwd: dir }),
    ).rejects.toThrow(/not found/);
  });

  test("denies .env path", async () => {
    await expect(
      readFileTool.execute({ path: ".env" }, { cwd: dir }),
    ).rejects.toThrow(/denied/);
  });

  test("denies credentials path", async () => {
    await expect(
      readFileTool.execute(
        { path: "secrets/credentials.json" },
        { cwd: dir },
      ),
    ).rejects.toThrow(/denied/);
  });
});
