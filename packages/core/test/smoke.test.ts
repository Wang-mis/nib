import { describe, expect, it } from "bun:test";
import { VERSION } from "../src/index.ts";

describe("@nib/core", () => {
  it("exports a semver-shaped VERSION", () => {
    expect(VERSION).toMatch(/^\d+\.\d+\.\d+/);
  });
});
