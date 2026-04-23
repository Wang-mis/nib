declare module "marked-terminal" {
  // The package exports a `markedTerminal` factory that returns a marked plugin.
  // We accept any options and let consumers cast the return type to whatever
  // marked.use() expects in the local marked version.
  export function markedTerminal(options?: Record<string, unknown>): unknown;
}
