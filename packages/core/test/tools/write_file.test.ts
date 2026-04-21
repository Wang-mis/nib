import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeFileTool } from "../../src/tools/write_file.ts";

describe("write_file tool", () => {
  let dir = "";

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "nib-write-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  test("is always dangerous", () => {
    expect(writeFileTool.isDangerous?.({ path: "x", content: "" })).toBe(true);
  });

  test("schema rejects missing content", () => {
    const result = writeFileTool.schema.safeParse({ path: "a" });
    expect(result.success).toBe(false);
  });

  test("writes file content", async () => {
    const out = await writeFileTool.execute(
      { path: "out.txt", content: "hello" },
      { cwd: dir },
    );
    expect(out.bytesWritten).toBe(5);
    const onDisk = await readFile(join(dir, "out.txt"), "utf8");
    expect(onDisk).toBe("hello");
  });

  test("creates parent dirs when requested", async () => {
    await writeFileTool.execute(
      { path: "nested/deeper/out.txt", content: "x", createDirs: true },
      { cwd: dir },
    );
    const onDisk = await readFile(join(dir, "nested/deeper/out.txt"), "utf8");
    expect(onDisk).toBe("x");
  });

  test("denies .env path", async () => {
    await expect(
      writeFileTool.execute({ path: ".env", content: "KEY=1" }, { cwd: dir }),
    ).rejects.toThrow(/denied/);
  });

  test("denies credentials path", async () => {
    await expect(
      writeFileTool.execute(
        { path: "aws-credentials.json", content: "{}" },
        { cwd: dir },
      ),
    ).rejects.toThrow(/denied/);
  });
});
