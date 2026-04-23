// Side-effect module: forces chalk (used by marked-terminal) to emit ANSI
// colors regardless of stdout TTY detection. Must be imported BEFORE any
// module that pulls in chalk (notably `marked-terminal`).
//
// Why: Ink renders to stdout via its own pipeline; depending on how the
// process is launched (piped, wrapped by `bun run`, Windows terminals,
// etc.), chalk may decide stdout has no color support and downgrade to
// plain text — which makes our markdown rendering look like raw text.
// Setting FORCE_COLOR=3 before chalk initializes locks it to truecolor.
if (!process.env["FORCE_COLOR"]) {
  process.env["FORCE_COLOR"] = "3";
}
