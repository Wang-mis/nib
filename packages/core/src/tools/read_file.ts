// read_file — read a UTF-8 text file with optional line offset/limit.
// Per PRD §7: deny .env and *credentials* paths by default.
import { resolve } from "node:path";
import { z } from "zod";
import type { Tool, ToolContext } from "./types.ts";

const READ_DENY_PATTERNS: readonly RegExp[] = Object.freeze([
  /(^|[\\/])\.env(\.|$)/i,
  /credentials/i,
]);

export const readFileSchema = z
  .object({
    path: z.string().min(1, "path is required"),
    offset: z.number().int().min(0).optional(),
    limit: z.number().int().min(1).max(100_000).optional(),
  })
  .strict();

export type ReadFileInput = z.infer<typeof readFileSchema>;

export interface ReadFileOutput {
  readonly path: string;
  readonly content: string;
  readonly totalLines: number;
  readonly truncated: boolean;
}

function isDeniedPath(path: string): boolean {
  return READ_DENY_PATTERNS.some((pattern) => pattern.test(path));
}

async function execute(
  input: ReadFileInput,
  ctx: ToolContext,
): Promise<ReadFileOutput> {
  if (isDeniedPath(input.path)) {
    throw new Error(`read_file: path '${input.path}' is denied by safety policy`);
  }

  const absolute = resolve(ctx.cwd, input.path);
  const file = Bun.file(absolute);
  if (!(await file.exists())) {
    throw new Error(`read_file: file not found: ${absolute}`);
  }

  const text = await file.text();
  const lines = text.split("\n");

  const offset = input.offset ?? 0;
  const limit = input.limit ?? lines.length;
  const slice = lines.slice(offset, offset + limit);
  const truncated = offset > 0 || offset + limit < lines.length;

  return Object.freeze({
    path: absolute,
    content: slice.join("\n"),
    totalLines: lines.length,
    truncated,
  });
}

export const readFileTool: Tool<ReadFileInput, ReadFileOutput> = Object.freeze({
  name: "read_file",
  description:
    "Read a UTF-8 text file. Optional `offset`/`limit` slice by line. Denies .env and credential paths.",
  schema: readFileSchema,
  execute,
});
