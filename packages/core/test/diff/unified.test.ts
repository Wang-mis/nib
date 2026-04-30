import { describe, expect, test } from "bun:test";
import { unifiedDiff } from "../../src/diff/unified.ts";

describe("unifiedDiff", () => {
  test("returns no hunks when content is identical", () => {
    const d = unifiedDiff("a\nb\nc\n", "a\nb\nc\n", "x.txt");
    expect(d.hunks).toEqual([]);
    expect(d.added).toBe(0);
    expect(d.removed).toBe(0);
  });

  test("detects a single line replacement", () => {
    const d = unifiedDiff("a\nb\nc\n", "a\nB\nc\n", "x.txt");
    expect(d.added).toBe(1);
    expect(d.removed).toBe(1);
    expect(d.hunks.length).toBe(1);
    const hunk = d.hunks[0]!;
    const ops = hunk.lines.map((l) => `${l.op}:${l.text}`);
    expect(ops).toContain("remove:b");
    expect(ops).toContain("add:B");
    expect(ops).toContain("equal:a");
    expect(ops).toContain("equal:c");
  });

  test("includes context around the change", () => {
    const oldStr = "1\n2\n3\n4\n5\n6\n7\n8\n9\n";
    const newStr = "1\n2\n3\n4\nFIVE\n6\n7\n8\n9\n";
    const d = unifiedDiff(oldStr, newStr, "x.txt");
    expect(d.hunks.length).toBe(1);
    const hunk = d.hunks[0]!;
    // 3 lines before "5", change, 3 lines after — total 7 lines from old + 1 add
    const equalLines = hunk.lines.filter((l) => l.op === "equal").map((l) => l.text);
    expect(equalLines).toEqual(["2", "3", "4", "6", "7", "8"]);
  });

  test("splits distant changes into multiple hunks", () => {
    const oldStr = Array.from({ length: 30 }, (_, i) => `line${i + 1}`).join("\n") + "\n";
    const lines = oldStr.split("\n");
    lines[1] = "TOP_CHANGE";
    lines[27] = "BOTTOM_CHANGE";
    const newStr = lines.join("\n");
    const d = unifiedDiff(oldStr, newStr, "x.txt");
    expect(d.hunks.length).toBe(2);
  });

  test("merges adjacent changes into one hunk when within context window", () => {
    const oldStr = "a\nb\nc\nd\ne\nf\ng\n";
    const newStr = "a\nB\nc\nD\ne\nf\ng\n";
    const d = unifiedDiff(oldStr, newStr, "x.txt");
    expect(d.hunks.length).toBe(1);
  });

  test("handles pure addition (empty old)", () => {
    const d = unifiedDiff("", "x\ny\n", "x.txt");
    expect(d.added).toBe(2);
    expect(d.removed).toBe(0);
    expect(d.hunks.length).toBe(1);
    expect(d.hunks[0]!.oldStart).toBe(0);
    expect(d.hunks[0]!.oldCount).toBe(0);
  });

  test("handles pure deletion (empty new)", () => {
    const d = unifiedDiff("x\ny\n", "", "x.txt");
    expect(d.added).toBe(0);
    expect(d.removed).toBe(2);
    expect(d.hunks.length).toBe(1);
    expect(d.hunks[0]!.newStart).toBe(0);
    expect(d.hunks[0]!.newCount).toBe(0);
  });

  test("computes correct hunk header start lines", () => {
    const oldStr = "1\n2\n3\n4\n5\n";
    const newStr = "1\n2\nTHREE\n4\n5\n";
    const d = unifiedDiff(oldStr, newStr, "x.txt");
    const h = d.hunks[0]!;
    // First line of the hunk slice is line "1" (oldLine=1, newLine=1) when contextLines=3.
    expect(h.oldStart).toBe(1);
    expect(h.newStart).toBe(1);
    expect(h.oldCount).toBe(5);
    expect(h.newCount).toBe(5);
  });
});
