// edit_file — exact string replacement with uniqueness check.
// Per PRD §6: prefer over write_file to save tokens. Always isDangerous.
// Per PRD §7: deny .env and *credentials* paths by default.
import { resolve } from "node:path";
import { z } from "zod";
import type { Tool, ToolContext } from "./types.ts";

const EDIT_DENY_PATTERNS: readonly RegExp[] = Object.freeze([
  /(^|[\\/])\.env(\.|$)/i,
  /credentials/i,
]);

export const editFileSchema = z
  .object({
    path: z.string().min(1, "path is required"),
    old_string: z.string().min(1, "old_string must be non-empty"),
    new_string: z.string(),
    replace_all: z.boolean().optional(),
  })
  .strict();

export type EditFileInput = z.infer<typeof editFileSchema>;

export interface EditFileOutput {
  readonly path: string;
  readonly replacements: number;
  readonly oldContent: string;
  readonly newContent: string;
}

function isDeniedPath(path: string): boolean {
  return EDIT_DENY_PATTERNS.some((pattern) => pattern.test(path));
}

function countOccurrences(haystack: string, needle: string): number {
  if (needle.length === 0) return 0;
  let count = 0;
  let from = 0;
  for (;;) {
    const idx = haystack.indexOf(needle, from);
    if (idx === -1) return count;
    count++;
    from = idx + needle.length;
  }
}

function replaceAll(haystack: string, needle: string, replacement: string): string {
  // Manual loop avoids regex escaping; mirrors countOccurrences semantics.
  if (needle.length === 0) return haystack;
  const parts: string[] = [];
  let from = 0;
  for (;;) {
    const idx = haystack.indexOf(needle, from);
    if (idx === -1) {
      parts.push(haystack.slice(from));
      return parts.join(replacement);
    }
    parts.push(haystack.slice(from, idx));
    from = idx + needle.length;
  }
}

async function execute(
  input: EditFileInput,
  ctx: ToolContext,
): Promise<EditFileOutput> {
  if (isDeniedPath(input.path)) {
    throw new Error(`edit_file: path '${input.path}' is denied by safety policy`);
  }
  if (input.old_string === input.new_string) {
    throw new Error("edit_file: old_string and new_string are identical — nothing to do");
  }

  const absolute = resolve(ctx.cwd, input.path);
  const file = Bun.file(absolute);
  if (!(await file.exists())) {
    throw new Error(`edit_file: file not found: ${absolute}`);
  }
  const oldContent = await file.text();

  const occurrences = countOccurrences(oldContent, input.old_string);
  if (occurrences === 0) {
    throw new Error(
      `edit_file: old_string not found in ${absolute}`,
    );
  }
  if (occurrences > 1 && !input.replace_all) {
    throw new Error(
      `edit_file: old_string matches ${occurrences} locations in ${absolute}; pass replace_all=true to replace all, or extend old_string to make it unique`,
    );
  }

  const newContent = input.replace_all
    ? replaceAll(oldContent, input.old_string, input.new_string)
    : oldContent.replace(input.old_string, input.new_string);

  await Bun.write(absolute, newContent);

  return Object.freeze({
    path: absolute,
    replacements: input.replace_all ? occurrences : 1,
    oldContent,
    newContent,
  });
}

export const editFileTool: Tool<EditFileInput, EditFileOutput> = Object.freeze({
  name: "edit_file",
  description:
    "Replace an exact string in a UTF-8 text file. Fails if old_string is not unique unless replace_all=true. Preferred over write_file for surgical edits. Always treated as dangerous.",
  schema: editFileSchema,
  execute,
  isDangerous: () => true,
});
