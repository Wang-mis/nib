// @nib/cli entry — Phase 0 hello world.
// Reads prompt + options from argv, streams from Anthropic, prints to stdout.
import {
  DEFAULT_MODELS,
  MODEL_ROLES,
  envVarForRole,
  isModelRole,
  resolveModel,
  streamAnthropic,
  VERSION,
  type ModelRole,
} from "@nib/core";

const ROLES_DISPLAY = MODEL_ROLES.join("|");

const HELP = `nib v${VERSION}

Usage:
  nib [options] "<prompt>"      Stream a single-shot reply
  nib --help | -h               Show this help
  nib --version | -v            Show version
  nib --models                  List role → model mapping (after env resolution)

Options:
  --role <${ROLES_DISPLAY}>
                                Pick a role-based default (default: main)
  --model <id>                  Explicit model id (overrides --role)
  --base-url <url>              Override Anthropic base URL (proxy / gateway)
  --max-tokens <n>              Max output tokens (default: 1024)

Environment:
  ANTHROPIC_API_KEY             Required. Your Anthropic API key.
  ANTHROPIC_BASE_URL            Optional. Override base URL.
${MODEL_ROLES.map(
    (r) => `  ${envVarForRole(r).padEnd(28)}  Override '${r}' role model.`,
  ).join("\n")}

Defaults:
${MODEL_ROLES.map((r) => `  ${r.padEnd(15)} → ${DEFAULT_MODELS[r]}`).join("\n")}
`;

interface ParsedArgs {
  help?: boolean;
  version?: boolean;
  models?: boolean;
  role?: ModelRole;
  model?: string;
  baseURL?: string;
  maxTokens?: number;
  prompt: string;
  error?: string;
}

function parseArgs(argv: readonly string[]): ParsedArgs {
  const out: ParsedArgs = { prompt: "" };
  const rest: string[] = [];

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--help" || a === "-h") {
      out.help = true;
    } else if (a === "--version" || a === "-v") {
      out.version = true;
    } else if (a === "--models") {
      out.models = true;
    } else if (a === "--role") {
      const v = argv[++i];
      if (!v || !isModelRole(v)) {
        out.error = `--role expects one of: ${ROLES_DISPLAY} (got ${v ?? "<missing>"})`;
        return out;
      }
      out.role = v;
    } else if (a === "--model") {
      const v = argv[++i];
      if (!v) {
        out.error = "--model expects a model id";
        return out;
      }
      out.model = v;
    } else if (a === "--base-url") {
      const v = argv[++i];
      if (!v) {
        out.error = "--base-url expects a URL";
        return out;
      }
      out.baseURL = v;
    } else if (a === "--max-tokens") {
      const v = argv[++i];
      const n = v ? Number.parseInt(v, 10) : NaN;
      if (!Number.isFinite(n) || n <= 0) {
        out.error = `--max-tokens expects a positive integer (got ${v ?? "<missing>"})`;
        return out;
      }
      out.maxTokens = n;
    } else if (a !== undefined && a.startsWith("--")) {
      out.error = `unknown option: ${a}`;
      return out;
    } else if (a !== undefined) {
      rest.push(a);
    }
  }
  out.prompt = rest.join(" ").trim();
  return out;
}

function printModels(): void {
  const lines = MODEL_ROLES.map(
    (r) => `  ${r.padEnd(15)} → ${resolveModel({ role: r })}`,
  );
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
      role: args.role,
      model: args.model,
      baseURL: args.baseURL,
      maxTokens: args.maxTokens,
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
