// glob — list files matching a pattern via Bun.Glob.
import { resolve } from "node:path";
import { z } from "zod";
import type { Tool, ToolContext } from "./types.ts";

const DEFAULT_LIMIT = 1000;

export const globSchema = z
  .object({
    pattern: z.string().min(1, "pattern is required"),
    cwd: z.string().optional(),
    limit: z.number().int().min(1).max(10_000).optional(),
  })
  .strict();

export type GlobInput = z.infer<typeof globSchema>;

export interface GlobOutput {
  readonly cwd: string;
  readonly pattern: string;
  readonly matches: readonly string[];
  readonly truncated: boolean;
}

async function execute(input: GlobInput, ctx: ToolContext): Promise<GlobOutput> {
  const cwd = resolve(ctx.cwd, input.cwd ?? ".");
  const limit = input.limit ?? DEFAULT_LIMIT;

  const glob = new Bun.Glob(input.pattern);
  const matches: string[] = [];
  let truncated = false;

  for await (const entry of glob.scan({ cwd, onlyFiles: true, dot: false })) {
    if (matches.length >= limit) {
      truncated = true;
      break;
    }
    matches.push(entry);
  }

  return Object.freeze({
    cwd,
    pattern: input.pattern,
    matches: Object.freeze([...matches.sort()]),
    truncated,
  });
}

export const globTool: Tool<GlobInput, GlobOutput> = Object.freeze({
  name: "glob",
  description:
    "List files matching a glob pattern (e.g. 'src/**/*.ts'). Returns sorted matches; capped at `limit` (default 1000).",
  schema: globSchema,
  execute,
});
