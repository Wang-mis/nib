// write_file — overwrite (or create) a UTF-8 text file. Always isDangerous.
// Per PRD §7: deny .env and *credentials* paths by default.
import { dirname, resolve } from "node:path";
import { mkdir } from "node:fs/promises";
import { z } from "zod";
import type { Tool, ToolContext } from "./types.ts";

const WRITE_DENY_PATTERNS: readonly RegExp[] = Object.freeze([
  /(^|[\\/])\.env(\.|$)/i,
  /credentials/i,
]);

export const writeFileSchema = z
  .object({
    path: z.string().min(1, "path is required"),
    content: z.string(),
    createDirs: z.boolean().optional(),
  })
  .strict();

export type WriteFileInput = z.infer<typeof writeFileSchema>;

export interface WriteFileOutput {
  readonly path: string;
  readonly bytesWritten: number;
}

function isDeniedPath(path: string): boolean {
  return WRITE_DENY_PATTERNS.some((pattern) => pattern.test(path));
}

async function execute(
  input: WriteFileInput,
  ctx: ToolContext,
): Promise<WriteFileOutput> {
  if (isDeniedPath(input.path)) {
    throw new Error(`write_file: path '${input.path}' is denied by safety policy`);
  }

  const absolute = resolve(ctx.cwd, input.path);
  if (input.createDirs) {
    await mkdir(dirname(absolute), { recursive: true });
  }

  const bytesWritten = await Bun.write(absolute, input.content);
  return Object.freeze({ path: absolute, bytesWritten });
}

export const writeFileTool: Tool<WriteFileInput, WriteFileOutput> = Object.freeze({
  name: "write_file",
  description:
    "Overwrite or create a UTF-8 text file. Always treated as dangerous; requires user approval.",
  schema: writeFileSchema,
  execute,
  isDangerous: () => true,
});
