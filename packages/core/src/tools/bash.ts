// bash — execute a shell command via Bun.spawn with timeout + abort + dangerous-pattern detection.
// Per PRD §7: rm -rf, git push --force, curl|sh patterns are flagged as dangerous.
import { z } from "zod";
import type { Tool, ToolContext } from "./types.ts";

const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_TIMEOUT_MS = 600_000;

const DANGEROUS_PATTERNS: readonly RegExp[] = Object.freeze([
  /\brm\s+-rf?\b/,
  /\bgit\s+push\b.*--force\b/,
  /\bgit\s+push\b.*\s-f(\s|$)/,
  /\bcurl\b[^|]*\|\s*sh\b/,
  /\bwget\b[^|]*\|\s*sh\b/,
  /:\(\)\s*\{[^}]*\};\s*:/, // fork bomb
  /\bmkfs\b/,
  /\bdd\s+if=.+of=\/dev\//,
]);

export const bashSchema = z
  .object({
    command: z.string().min(1, "command is required"),
    timeoutMs: z.number().int().min(1).max(MAX_TIMEOUT_MS).optional(),
    cwd: z.string().optional(),
  })
  .strict();

export type BashInput = z.infer<typeof bashSchema>;

export interface BashOutput {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
  readonly timedOut: boolean;
}

function detectDangerous(command: string): boolean {
  return DANGEROUS_PATTERNS.some((pattern) => pattern.test(command));
}

function pickShell(): readonly string[] {
  if (process.platform === "win32") {
    return Object.freeze(["cmd.exe", "/d", "/s", "/c"]);
  }
  return Object.freeze(["/bin/sh", "-c"]);
}

async function execute(input: BashInput, ctx: ToolContext): Promise<BashOutput> {
  const timeout = input.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const shell = pickShell();
  const cwd = input.cwd ?? ctx.cwd;

  const controller = new AbortController();
  const onAbort = (): void => controller.abort();
  ctx.signal?.addEventListener("abort", onAbort, { once: true });

  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeout);

  try {
    const proc = Bun.spawn({
      cmd: [...shell, input.command],
      cwd,
      env: ctx.env as Record<string, string> | undefined,
      stdout: "pipe",
      stderr: "pipe",
      signal: controller.signal,
    });

    const [stdoutText, stderrText, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);

    return Object.freeze({
      stdout: stdoutText,
      stderr: stderrText,
      exitCode: typeof exitCode === "number" ? exitCode : -1,
      timedOut,
    });
  } finally {
    clearTimeout(timer);
    ctx.signal?.removeEventListener("abort", onAbort);
  }
}

export const bashTool: Tool<BashInput, BashOutput> = Object.freeze({
  name: "bash",
  description:
    "Run a shell command. Has a default 30s timeout. Dangerous patterns (rm -rf, force push, curl|sh) are flagged.",
  schema: bashSchema,
  execute,
  isDangerous: (input: BashInput) => detectDangerous(input.command),
});

export const __testables = Object.freeze({ detectDangerous });
