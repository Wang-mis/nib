// Loads `~/.nib/.env` into process.env without overwriting values already set
// by the shell or by Bun's CWD `.env` auto-loader.
//
// Precedence (highest first):
//   1. Shell exports (already in process.env when this runs)
//   2. CWD `.env` (Bun auto-loads this before user code runs)
//   3. `~/.nib/.env`        ← this module
//
// Importing this file runs `loadNibEnv()` once with the default location
// (`$NIB_HOME` or `~/.nib`). Must be imported BEFORE any module that reads
// process.env at import time (providers, force-color, etc.).
import { homedir } from "node:os";
import { join } from "node:path";
import { readFileSync, existsSync } from "node:fs";

export function parseDotenv(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq < 1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

/** Load a `.env` file into process.env without overwriting existing keys. */
export function loadEnvFile(path: string): void {
  if (!existsSync(path)) return;
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    return;
  }
  const parsed = parseDotenv(text);
  for (const [k, v] of Object.entries(parsed)) {
    if (process.env[k] === undefined) process.env[k] = v;
  }
}

/** Resolve the Nib home dir (NIB_HOME env or ~/.nib) and load its .env. */
export function loadNibEnv(): void {
  const home = process.env["NIB_HOME"] ?? join(homedir(), ".nib");
  loadEnvFile(join(home, ".env"));
}

loadNibEnv();
