// Tool interface (per docs/ARCH.md). Tools are the unit of capability.
// Each tool declares a Zod schema for its input; the registry validates before execute().
import type { z } from "zod";

export interface ToolContext {
  /** Working directory for filesystem-relative tool operations. */
  readonly cwd: string;
  /** Cancellation signal — long-running tools (bash) MUST honor this. */
  readonly signal?: AbortSignal;
  /** Environment variables visible to subprocesses. Defaults to process.env. */
  readonly env?: Readonly<Record<string, string | undefined>>;
}

/**
 * A capability the agent can invoke.
 * `I` is inferred from `schema`; `O` is the concrete output shape.
 */
export interface Tool<I, O> {
  readonly name: string;
  readonly description: string;
  readonly schema: z.ZodType<I>;
  execute(input: I, ctx: ToolContext): Promise<O>;
  /** Optional gating predicate. Registry callers should check this before invocation. */
  isDangerous?(input: I): boolean;
}

/** A tool whose input/output shapes are erased — registry-internal use. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyTool = Tool<any, any>;

export class ToolValidationError extends Error {
  constructor(
    public readonly toolName: string,
    public readonly issues: readonly string[],
  ) {
    super(`tool '${toolName}' input failed validation: ${issues.join("; ")}`);
    this.name = "ToolValidationError";
  }
}

export class ToolNotFoundError extends Error {
  constructor(public readonly toolName: string) {
    super(`tool '${toolName}' is not registered`);
    this.name = "ToolNotFoundError";
  }
}
