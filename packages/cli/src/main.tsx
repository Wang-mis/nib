// @nib/cli entry — Phase 0 hello world.
// Reads prompt from argv, streams from Anthropic, prints to stdout.
//
// Model selection is NOT a startup flag. It happens per-task: a skill /
// subagent / tool can request a role (e.g. `model: haiku`) and the core
// resolves it via env (NIB_MODEL_<ROLE>) or built-in default. Phase 0 has
// no skills yet, so every prompt uses the "main" role implicitly.
import {
  DEFAULT_MODELS,
  MODEL_ROLES,
  envVarForRole,
  resolveModel,
  streamAnthropic,
  VERSION,
} from "@nib/core";

const HELP = `nib v${VERSION}

Usage:
  nib "<prompt>"                Stream a single-shot reply (uses 'main' role)
  nib --help | -h               Show this help
  nib --version | -v            Show version
  nib --models                  Show role → model mapping (after env resolution)

Environment:
  ANTHROPIC_API_KEY             Required. Your Anthropic API key.
  ANTHROPIC_BASE_URL            Optional. Override base URL.
${MODEL_ROLES.map(
    (r) => `  ${envVarForRole(r).padEnd(22)}  Override '${r}' role model.`,
  ).join("\n")}

Defaults:
${MODEL_ROLES.map((r) => `  ${r.padEnd(10)} → ${DEFAULT_MODELS[r]}`).join("\n")}
`;

interface ParsedArgs {
  help?: boolean;
  version?: boolean;
  models?: boolean;
  prompt: string;
  error?: string;
}

function parseArgs(argv: readonly string[]): ParsedArgs {
  const out: ParsedArgs = { prompt: "" };
  const rest: string[] = [];

  for (const a of argv) {
    if (a === "--help" || a === "-h") {
      out.help = true;
    } else if (a === "--version" || a === "-v") {
      out.version = true;
    } else if (a === "--models") {
      out.models = true;
    } else if (a.startsWith("--")) {
      out.error = `unknown option: ${a}`;
      return out;
    } else {
      rest.push(a);
    }
  }
  out.prompt = rest.join(" ").trim();
  return out;
}

function printModels(): void {
  const lines = MODEL_ROLES.map((r) => `  ${r.padEnd(10)} → ${resolveModel({ role: r })}`);
  process.stdout.write(`Resolved models:\n${lines.join("\n")}\n`);
  const baseURL = process.env["ANTHROPIC_BASE_URL"];
  if (baseURL) process.stdout.write(`Base URL: ${baseURL}\n`);
}

export async function main(argv: string[] = process.argv.slice(2)): Promise<number> {
  const args = parseArgs(argv);

  if (args.error) {
    process.stderr.write(`nib: ${args.error}\n`);
    return 2;
  }
  if (args.version) {
    process.stdout.write(`nib v${VERSION}\n`);
    return 0;
  }
  if (args.help) {
    process.stdout.write(HELP);
    return 0;
  }
  if (args.models) {
    printModels();
    return 0;
  }
  if (!args.prompt) {
    process.stdout.write(HELP);
    return 1;
  }

  const controller = new AbortController();
  const onSig = (): void => controller.abort();
  process.on("SIGINT", onSig);
  process.on("SIGTERM", onSig);

  try {
    let saw = false;
    for await (const ev of streamAnthropic({
      prompt: args.prompt,
      // Phase 0: implicit "main" role; future skills/subagents will pass their own.
      signal: controller.signal,
    })) {
      if (ev.kind === "text" && ev.text) {
        process.stdout.write(ev.text);
        saw = true;
      } else if (ev.kind === "error") {
        process.stderr.write(`\nnib: ${ev.error?.message ?? "unknown error"}\n`);
        return 1;
      }
    }
    if (saw) process.stdout.write("\n");
    return 0;
  } finally {
    process.off("SIGINT", onSig);
    process.off("SIGTERM", onSig);
  }
}
