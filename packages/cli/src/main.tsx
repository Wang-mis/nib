// @nib/cli entry — Phase 0 hello world.
// Reads prompt from argv, streams from Anthropic, prints to stdout.
import { streamAnthropic, VERSION } from "@nib/core";

const HELP = `nib v${VERSION}

Usage:
  nib "<prompt>"            Stream a single-shot reply from Claude
  nib --help | -h           Show this help
  nib --version | -v        Show version

Environment:
  ANTHROPIC_API_KEY         Required. Your Anthropic API key.
  NIB_MODEL                 Optional. Override model (default: claude-sonnet-4-5).
`;

export async function main(argv: string[] = process.argv.slice(2)): Promise<number> {
  if (argv.length === 0 || argv[0] === "--help" || argv[0] === "-h") {
    process.stdout.write(HELP);
    return argv.length === 0 ? 1 : 0;
  }
  if (argv[0] === "--version" || argv[0] === "-v") {
    process.stdout.write(`nib v${VERSION}\n`);
    return 0;
  }

  const prompt = argv.join(" ").trim();
  if (!prompt) {
    process.stderr.write("nib: empty prompt\n");
    return 1;
  }

  const controller = new AbortController();
  const onSig = (): void => controller.abort();
  process.on("SIGINT", onSig);
  process.on("SIGTERM", onSig);

  try {
    let saw = false;
    for await (const ev of streamAnthropic({
      prompt,
      model: process.env.NIB_MODEL,
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
