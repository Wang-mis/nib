// ToolRegistry — immutable map of tool name → tool. Validates input via Zod before dispatch.
import { z } from "zod";
import {
  ToolNotFoundError,
  ToolValidationError,
  type AnyTool,
  type Tool,
  type ToolContext,
} from "./types.ts";
import { readFileTool } from "./read_file.ts";
import { writeFileTool } from "./write_file.ts";
import { bashTool } from "./bash.ts";
import { globTool } from "./glob.ts";

export class ToolRegistry {
  private readonly tools: ReadonlyMap<string, AnyTool>;

  private constructor(tools: ReadonlyMap<string, AnyTool>) {
    this.tools = tools;
  }

  static from(tools: readonly AnyTool[]): ToolRegistry {
    const map = new Map<string, AnyTool>();
    for (const tool of tools) {
      if (map.has(tool.name)) {
        throw new Error(`ToolRegistry: duplicate tool name '${tool.name}'`);
      }
      map.set(tool.name, tool);
    }
    return new ToolRegistry(map);
  }

  /** Returns a new registry with the additional tool — never mutates `this`. */
  withTool(tool: AnyTool): ToolRegistry {
    if (this.tools.has(tool.name)) {
      throw new Error(`ToolRegistry: duplicate tool name '${tool.name}'`);
    }
    const next = new Map(this.tools);
    next.set(tool.name, tool);
    return new ToolRegistry(next);
  }

  list(): readonly AnyTool[] {
    return Object.freeze([...this.tools.values()]);
  }

  get(name: string): AnyTool | undefined {
    return this.tools.get(name);
  }

  /** Validate raw input against the tool's Zod schema, then execute. */
  async dispatch(
    name: string,
    input: unknown,
    ctx: ToolContext,
  ): Promise<unknown> {
    const tool = this.tools.get(name);
    if (!tool) {
      throw new ToolNotFoundError(name);
    }
    const parsed = tool.schema.safeParse(input);
    if (!parsed.success) {
      const issues = parsed.error.issues.map(
        (i: z.core.$ZodIssue) => `${i.path.join(".") || "<root>"}: ${i.message}`,
      );
      throw new ToolValidationError(name, issues);
    }
    return tool.execute(parsed.data, ctx);
  }
}

/** Default registry containing all Sprint 1 MVP tools. */
export function defaultRegistry(): ToolRegistry {
  return ToolRegistry.from([
    readFileTool,
    writeFileTool,
    bashTool,
    globTool,
  ] as readonly AnyTool[]);
}

export type { Tool, ToolContext };
