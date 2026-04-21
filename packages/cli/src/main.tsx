// @nib/cli entry — ReAct agent loop with default tools, rendered via Ink TUI.
import React from "react";
import { render } from "ink";
import {
  DEFAULT_LIMITS,
  DEFAULT_MODELS,
  MODEL_ROLES,
  envVarForRole,
  resolveModel,
  VERSION,
} from "@nib/core";
import { App } from "./components/App.tsx";

const HELP = `nib v${VERSION}

Usage:
  nib "<prompt>"                Run the agent with default tools (read_file,
                                write_file, bash, glob). Renders via Ink TUI.
  nib --yes "<prompt>"          Auto-approve all tool calls (DANGEROUS).
  nib --max-steps N "<prompt>"  Override step cap (default ${DEFAULT_LIMITS.maxSteps}).
  nib --help | -h               Show this help
  nib --version | -v            Show version
  nib --models                  Show role → model mapping (after env resolution)

Environment:
  ANTHROPIC_API_KEY             Required. Your Anthropic API key.
  ANTHROPIC_BASE_URL            Optional. Override base URL.
${MODEL_ROLES.map(
    (r) => `  ${envVarForRole(r).padEnd(22)}  Override '${r}' role model.`,
  ).join("\n")}

Defaults (per-role models):
${MODEL_ROLES.map((r) => `  ${r.padEnd(10)} → ${DEFAULT_MODELS[r]}`).join("\n")}

Limits (per session):
  steps=${DEFAULT_LIMITS.maxSteps}  tokens=${DEFAULT_LIMITS.maxTokens}  cost=$${DEFAULT_LIMITS.maxCostUSD.toFixed(2)}  per-call timeout=${DEFAULT_LIMITS.perCallTimeoutMs}ms
`;

export interface ParsedArgs {
  help?: boolean;
  version?: boolean;
  models?: boolean;
  autoApprove?: boolean;
  maxSteps?: number;
  prompt: string;
  error?: string;
}

export function parseArgs(argv: readonly string[]): ParsedArgs {
  const out: ParsedArgs = { prompt: "" };
  const rest: string[] = [];

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === undefined) continue;
    if (a === "--help" || a === "-h") {
      out.help = true;
    } else if (a === "--version" || a === "-v") {
      out.version = true;
    } else if (a === "--models") {
      out.models = true;
    } else if (a === "--yes" || a === "-y") {
      out.autoApprove = true;
    } else if (a === "--max-steps") {
      const next = argv[i + 1];
      const n = next ? Number.parseInt(next, 10) : NaN;
      if (!Number.isFinite(n) || n < 1) {
        out.error = "--max-steps requires a positive integer";
        return out;
      }
      out.maxSteps = n;
      i++;
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

async function runTui(args: ParsedArgs): Promise<number> {
  const instance = render(
    React.createElement(App, {
      prompt: args.prompt,
      autoApprove: args.autoApprove ?? false,
      limits: args.maxSteps ? { maxSteps: args.maxSteps } : undefined,
    }),
  );
  await instance.waitUntilExit();
  return 0;
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

  return runTui(args);
}
