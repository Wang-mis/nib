// Unified diff with hunks. Pure TS, no dependencies.
// Algorithm: classic LCS DP on lines, then collapse runs of equal lines into
// context (with `contextLines` margin around each change), and split into hunks
// wherever the gap between changes exceeds 2*contextLines.

export type DiffOp = "equal" | "add" | "remove";

export interface DiffLine {
  readonly op: DiffOp;
  /** Old-file line number (1-based), or null for "add". */
  readonly oldLine: number | null;
  /** New-file line number (1-based), or null for "remove". */
  readonly newLine: number | null;
  readonly text: string;
}

export interface DiffHunk {
  readonly oldStart: number;
  readonly oldCount: number;
  readonly newStart: number;
  readonly newCount: number;
  readonly lines: readonly DiffLine[];
}

export interface UnifiedDiff {
  readonly path: string;
  readonly hunks: readonly DiffHunk[];
  readonly added: number;
  readonly removed: number;
}

export interface UnifiedDiffOptions {
  /** Lines of unchanged context around each change (default 3). */
  readonly contextLines?: number;
}

/**
 * Compute the line-level edit script via Longest Common Subsequence.
 * Returns flat ops in original order. O(n*m) time/space — fine for source files.
 */
function lcsDiff(a: readonly string[], b: readonly string[]): DiffLine[] {
  const n = a.length;
  const m = b.length;
  // dp[i][j] = LCS length of a[i..] and b[j..]
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      const row = dp[i];
      const next = dp[i + 1];
      if (!row || !next) continue;
      if (a[i] === b[j]) {
        row[j] = (next[j + 1] ?? 0) + 1;
      } else {
        row[j] = Math.max(next[j] ?? 0, row[j + 1] ?? 0);
      }
    }
  }

  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      out.push({ op: "equal", oldLine: i + 1, newLine: j + 1, text: a[i] ?? "" });
      i++;
      j++;
      continue;
    }
    const down = dp[i + 1]?.[j] ?? 0;
    const right = dp[i]?.[j + 1] ?? 0;
    if (down >= right) {
      out.push({ op: "remove", oldLine: i + 1, newLine: null, text: a[i] ?? "" });
      i++;
    } else {
      out.push({ op: "add", oldLine: null, newLine: j + 1, text: b[j] ?? "" });
      j++;
    }
  }
  while (i < n) {
    out.push({ op: "remove", oldLine: i + 1, newLine: null, text: a[i] ?? "" });
    i++;
  }
  while (j < m) {
    out.push({ op: "add", oldLine: null, newLine: j + 1, text: b[j] ?? "" });
    j++;
  }
  return out;
}

/** Split a string into lines, preserving every line and dropping the trailing
 * empty entry from a final newline so equal files compare as equal. */
function splitLines(s: string): string[] {
  if (s === "") return [];
  const lines = s.split("\n");
  if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  return lines;
}

/** Group ops into hunks, including ±contextLines of "equal" lines around each change. */
function buildHunks(ops: readonly DiffLine[], contextLines: number): DiffHunk[] {
  // Find indices of changed lines.
  const changedIdx: number[] = [];
  for (let i = 0; i < ops.length; i++) {
    const op = ops[i];
    if (op && op.op !== "equal") changedIdx.push(i);
  }
  if (changedIdx.length === 0) return [];

  // Walk changed indices and merge into ranges that include contextLines on each side.
  const ranges: Array<{ start: number; end: number }> = [];
  for (const idx of changedIdx) {
    const start = Math.max(0, idx - contextLines);
    const end = Math.min(ops.length - 1, idx + contextLines);
    const last = ranges[ranges.length - 1];
    if (last && start <= last.end + 1) {
      last.end = Math.max(last.end, end);
    } else {
      ranges.push({ start, end });
    }
  }

  return ranges.map((r) => {
    const slice = ops.slice(r.start, r.end + 1);
    let oldStart = 0;
    let newStart = 0;
    let oldCount = 0;
    let newCount = 0;
    for (const line of slice) {
      if (line.op !== "add") {
        if (oldStart === 0 && line.oldLine !== null) oldStart = line.oldLine;
        oldCount++;
      }
      if (line.op !== "remove") {
        if (newStart === 0 && line.newLine !== null) newStart = line.newLine;
        newCount++;
      }
    }
    // For an empty side (e.g. file becomes empty), git uses 0,0.
    return Object.freeze({
      oldStart: oldCount === 0 ? 0 : oldStart,
      oldCount,
      newStart: newCount === 0 ? 0 : newStart,
      newCount,
      lines: Object.freeze(slice),
    });
  });
}

export function unifiedDiff(
  oldContent: string,
  newContent: string,
  path: string,
  options: UnifiedDiffOptions = {},
): UnifiedDiff {
  const contextLines = options.contextLines ?? 3;
  const oldLines = splitLines(oldContent);
  const newLines = splitLines(newContent);
  const ops = lcsDiff(oldLines, newLines);

  let added = 0;
  let removed = 0;
  for (const op of ops) {
    if (op.op === "add") added++;
    else if (op.op === "remove") removed++;
  }

  const hunks = buildHunks(ops, contextLines);
  return Object.freeze({
    path,
    hunks: Object.freeze(hunks),
    added,
    removed,
  });
}
