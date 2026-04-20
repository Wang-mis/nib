import { describe, expect, it } from "bun:test";
import { main } from "../src/main.tsx";

describe("@nib/cli main()", () => {
  it("prints version with --version", async () => {
    const orig = process.stdout.write.bind(process.stdout);
    let captured = "";
    process.stdout.write = ((chunk: string | Uint8Array): boolean => {
      captured += typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk);
      return true;
    }) as typeof process.stdout.write;
    try {
      const code = await main(["--version"]);
      expect(code).toBe(0);
      expect(captured).toMatch(/^nib v\d+\.\d+\.\d+/);
    } finally {
      process.stdout.write = orig;
    }
  });

  it("exits 1 with no args", async () => {
    const orig = process.stdout.write.bind(process.stdout);
    process.stdout.write = ((): boolean => true) as typeof process.stdout.write;
    try {
      const code = await main([]);
      expect(code).toBe(1);
    } finally {
      process.stdout.write = orig;
    }
  });
});
