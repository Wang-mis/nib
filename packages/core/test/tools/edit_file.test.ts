import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { editFileTool } from "../../src/tools/edit_file.ts";

describe("edit_file tool", () => {
  let dir = "";

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "nib-edit-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  test("is always dangerous", () => {
    expect(
      editFileTool.isDangerous?.({ path: "x", old_string: "a", new_string: "b" }),
    ).toBe(true);
  });

  test("schema rejects empty old_string", () => {
    const result = editFileTool.schema.safeParse({
      path: "a",
      old_string: "",
      new_string: "x",
    });
    expect(result.success).toBe(false);
  });

  test("schema rejects unknown fields", () => {
    const result = editFileTool.schema.safeParse({
      path: "a",
      old_string: "x",
      new_string: "y",
      junk: 1,
    });
    expect(result.success).toBe(false);
  });

  test("replaces a unique occurrence", async () => {
    const file = join(dir, "f.txt");
    await writeFile(file, "alpha\nbeta\ngamma\n");
    const out = await editFileTool.execute(
      { path: "f.txt", old_string: "beta", new_string: "BETA" },
      { cwd: dir },
    );
    expect(out.replacements).toBe(1);
    expect(out.oldContent).toBe("alpha\nbeta\ngamma\n");
    expect(out.newContent).toBe("alpha\nBETA\ngamma\n");
    expect(await readFile(file, "utf8")).toBe("alpha\nBETA\ngamma\n");
  });

  test("throws when old_string is not found", async () => {
    const file = join(dir, "f.txt");
    await writeFile(file, "hello\n");
    await expect(
      editFileTool.execute(
        { path: "f.txt", old_string: "nope", new_string: "x" },
        { cwd: dir },
      ),
    ).rejects.toThrow(/not found/);
  });

  test("throws when old_string matches multiple times without replace_all", async () => {
    const file = join(dir, "f.txt");
    await writeFile(file, "x\nx\nx\n");
    await expect(
      editFileTool.execute(
        { path: "f.txt", old_string: "x", new_string: "y" },
        { cwd: dir },
      ),
    ).rejects.toThrow(/matches 3 locations/);
  });

  test("replace_all replaces every occurrence", async () => {
    const file = join(dir, "f.txt");
    await writeFile(file, "x-x-x");
    const out = await editFileTool.execute(
      {
        path: "f.txt",
        old_string: "x",
        new_string: "yy",
        replace_all: true,
      },
      { cwd: dir },
    );
    expect(out.replacements).toBe(3);
    expect(out.newContent).toBe("yy-yy-yy");
    expect(await readFile(file, "utf8")).toBe("yy-yy-yy");
  });

  test("throws when old_string equals new_string", async () => {
    const file = join(dir, "f.txt");
    await writeFile(file, "abc");
    await expect(
      editFileTool.execute(
        { path: "f.txt", old_string: "abc", new_string: "abc" },
        { cwd: dir },
      ),
    ).rejects.toThrow(/identical/);
  });

  test("throws on missing file", async () => {
    await expect(
      editFileTool.execute(
        { path: "nope.txt", old_string: "a", new_string: "b" },
        { cwd: dir },
      ),
    ).rejects.toThrow(/not found/);
  });

  test("denies .env path", async () => {
    await expect(
      editFileTool.execute(
        { path: ".env", old_string: "A", new_string: "B" },
        { cwd: dir },
      ),
    ).rejects.toThrow(/denied/);
  });

  test("denies credentials path", async () => {
    await expect(
      editFileTool.execute(
        {
          path: "aws-credentials.json",
          old_string: "A",
          new_string: "B",
        },
        { cwd: dir },
      ),
    ).rejects.toThrow(/denied/);
  });
});
