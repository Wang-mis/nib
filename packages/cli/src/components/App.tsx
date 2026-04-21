// Ink TUI app — Phase 1 Sprint 2.
// Renders the agent event stream: assistant text, tool_use chips, tool results,
// and a footer showing step / token / cost. Press Ctrl+O to toggle a verbose
// details panel that shows the full input/output payload of every tool call.
import React, { useEffect, useState } from "react";
import { Box, Static, Text, useApp, useInput } from "ink";
import {
  defaultRegistry,
  runAgent,
  type AgentEvent,
  type AgentLimits,
} from "@nib/core";

interface AppProps {
  prompt: string;
  autoApprove: boolean;
  limits?: Partial<AgentLimits>;
}

interface LogLine {
  id: number;
  kind: "text" | "tool" | "tool_result" | "tool_error" | "tool_denied" | "info" | "error";
  text: string;
}

interface ToolCallRecord {
  id: string;
  step: number;
  name: string;
  input: unknown;
  status: "pending" | "ok" | "error" | "denied";
  output?: unknown;
  errorMessage?: string;
  startedAt: number;
  finishedAt?: number;
}

interface Status {
  step: number;
  inputTokens: number;
  outputTokens: number;
  costUSD: number;
  reason?: string;
  done: boolean;
  error?: string;
}

const INITIAL_STATUS: Status = Object.freeze({
  step: 0,
  inputTokens: 0,
  outputTokens: 0,
  costUSD: 0,
  done: false,
});

const STATUS_GLYPH: Record<ToolCallRecord["status"], string> = {
  pending: "◌",
  ok: "✓",
  error: "✗",
  denied: "⊘",
};

function colorForStatus(status: ToolCallRecord["status"]): string {
  switch (status) {
    case "ok":
      return "green";
    case "error":
      return "red";
    case "denied":
      return "yellow";
    default:
      return "cyan";
  }
}

function colorForKind(kind: LogLine["kind"]): string {
  switch (kind) {
    case "tool":
      return "cyan";
    case "tool_result":
      return "green";
    case "tool_error":
      return "red";
    case "tool_denied":
      return "yellow";
    case "error":
      return "red";
    case "info":
      return "gray";
    default:
      return "white";
  }
}

// Picks the most identifying argument for a given tool — used in the compact chip.
function chipPreview(name: string, input: unknown): string {
  if (input === null || typeof input !== "object") return "";
  const obj = input as Record<string, unknown>;
  const candidates: Record<string, readonly string[]> = {
    read_file: ["path"],
    write_file: ["path"],
    bash: ["command"],
    glob: ["pattern"],
  };
  const keys = candidates[name] ?? Object.keys(obj).slice(0, 1);
  for (const key of keys) {
    const val = obj[key];
    if (typeof val === "string" && val.length > 0) {
      return truncate(val, 80);
    }
  }
  return "";
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 1) + "…";
}

function prettyJson(v: unknown): string {
  if (v === undefined) return "(none)";
  try {
    return JSON.stringify(v, null, 2);
  } catch {
    return String(v);
  }
}

// Renders an output preview that's easy to scan: short scalars inline,
// long strings collapsed with line/char counts.
function outputSummary(v: unknown): { preview: string; meta?: string } {
  if (v === undefined) return { preview: "(none)" };
  if (v === null) return { preview: "null" };
  if (typeof v === "string") {
    const lines = v.split("\n").length;
    return {
      preview: v.length > 600 ? v.slice(0, 600) + "…" : v,
      meta: `${v.length} chars · ${lines} lines`,
    };
  }
  if (typeof v === "object") {
    try {
      const json = JSON.stringify(v, null, 2);
      const lines = json.split("\n").length;
      return {
        preview: json.length > 800 ? json.slice(0, 800) + "…" : json,
        meta: `${lines} lines`,
      };
    } catch {
      return { preview: String(v) };
    }
  }
  return { preview: String(v) };
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

export function App({ prompt, autoApprove, limits }: AppProps): React.JSX.Element {
  const { exit } = useApp();
  const [lines, setLines] = useState<readonly LogLine[]>([]);
  const [toolCalls, setToolCalls] = useState<readonly ToolCallRecord[]>([]);
  const [status, setStatus] = useState<Status>(INITIAL_STATUS);
  const [verbose, setVerbose] = useState(false);

  // Ctrl+O toggles the verbose tool-call details panel.
  useInput((input, key) => {
    if (key.ctrl && (input === "o" || input === "O")) {
      setVerbose((v) => !v);
    }
  });

  useEffect(() => {
    let nextId = 0;
    let currentStep = 0;
    const append = (line: Omit<LogLine, "id">): void => {
      const id = nextId++;
      setLines((prev) => [...prev, { ...line, id }]);
    };
    const upsertToolCall = (
      id: string,
      patch: Partial<ToolCallRecord> & Pick<ToolCallRecord, "name">,
    ): void => {
      setToolCalls((prev) => {
        const idx = prev.findIndex((r) => r.id === id);
        if (idx === -1) {
          return [
            ...prev,
            {
              id,
              step: currentStep,
              status: "pending",
              input: undefined,
              startedAt: Date.now(),
              ...patch,
            },
          ];
        }
        const next = [...prev];
        const prevRec = next[idx]!;
        const nowFinished =
          patch.status === "ok" || patch.status === "error" || patch.status === "denied";
        next[idx] = {
          ...prevRec,
          ...patch,
          finishedAt: nowFinished ? Date.now() : prevRec.finishedAt,
        };
        return next;
      });
    };

    const controller = new AbortController();
    const onSig = (): void => controller.abort();
    process.on("SIGINT", onSig);
    process.on("SIGTERM", onSig);

    void (async () => {
      try {
        for await (const ev of runAgent({
          prompt,
          registry: defaultRegistry(),
          autoApprove,
          limits,
          signal: controller.signal,
        })) {
          if (ev.kind === "step_start") currentStep = ev.step;
          handleEvent(ev, append, upsertToolCall, setStatus);
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setStatus((s) => ({ ...s, error: message, done: true }));
      } finally {
        process.off("SIGINT", onSig);
        process.off("SIGTERM", onSig);
        // Allow Ink to flush before exit
        setTimeout(() => exit(), 50);
      }
    })();
  }, [prompt, autoApprove, limits, exit]);

  return (
    <Box flexDirection="column">
      <Static items={[...lines]}>
        {(line) => (
          <Text key={line.id} color={colorForKind(line.kind)}>
            {line.text}
          </Text>
        )}
      </Static>
      {verbose ? <ToolDetailsPanel toolCalls={toolCalls} /> : null}
      <Footer status={status} verbose={verbose} toolCount={toolCalls.length} />
    </Box>
  );
}

function ToolDetailsPanel({
  toolCalls,
}: {
  toolCalls: readonly ToolCallRecord[];
}): React.JSX.Element {
  const okCount = toolCalls.filter((t) => t.status === "ok").length;
  const errCount = toolCalls.filter((t) => t.status === "error").length;
  const denyCount = toolCalls.filter((t) => t.status === "denied").length;
  const pendCount = toolCalls.filter((t) => t.status === "pending").length;

  return (
    <Box
      flexDirection="column"
      marginTop={1}
      borderStyle="round"
      borderColor="cyan"
      paddingX={1}
      paddingY={0}
    >
      <Box>
        <Text bold color="cyan">
          ⚙ Tool Calls
        </Text>
        <Text dimColor>
          {"  "}
          {toolCalls.length} total
          {okCount > 0 ? ` · ${okCount} ok` : ""}
          {errCount > 0 ? ` · ${errCount} err` : ""}
          {denyCount > 0 ? ` · ${denyCount} denied` : ""}
          {pendCount > 0 ? ` · ${pendCount} pending` : ""}
        </Text>
      </Box>
      {toolCalls.length === 0 ? (
        <Box marginTop={1}>
          <Text dimColor italic>
            no tool calls yet — model is thinking…
          </Text>
        </Box>
      ) : (
        toolCalls.map((rec, i) => (
          <ToolCallCard key={rec.id} record={rec} index={i + 1} />
        ))
      )}
    </Box>
  );
}

function ToolCallCard({
  record,
  index,
}: {
  record: ToolCallRecord;
  index: number;
}): React.JSX.Element {
  const color = colorForStatus(record.status);
  const glyph = STATUS_GLYPH[record.status];
  const duration =
    record.finishedAt !== undefined
      ? formatDuration(record.finishedAt - record.startedAt)
      : "running…";
  const out = outputSummary(record.output);

  return (
    <Box flexDirection="column" marginTop={1}>
      {/* Header line: glyph · #N · name · step · duration · status */}
      <Box>
        <Text color={color} bold>
          {glyph} {String(index).padStart(2, " ")}{" "}
        </Text>
        <Text bold color={color}>
          {record.name}
        </Text>
        <Text dimColor>
          {"  "}step {record.step} · {duration} · {record.status}
        </Text>
      </Box>

      {/* Input block */}
      <Box flexDirection="column" marginLeft={3}>
        <Text dimColor>┌ input</Text>
        <Box marginLeft={2} flexDirection="column">
          <Text>{prettyJson(record.input)}</Text>
        </Box>

        {/* Output / error / denied */}
        {record.status === "ok" ? (
          <>
            <Text dimColor>
              └ output{out.meta ? `  (${out.meta})` : ""}
            </Text>
            <Box marginLeft={2} flexDirection="column">
              <Text color="green">{out.preview}</Text>
            </Box>
          </>
        ) : record.status === "error" ? (
          <>
            <Text dimColor>└ error</Text>
            <Box marginLeft={2}>
              <Text color="red">{record.errorMessage ?? "(no message)"}</Text>
            </Box>
          </>
        ) : record.status === "denied" ? (
          <>
            <Text dimColor>└ result</Text>
            <Box marginLeft={2}>
              <Text color="yellow">denied by user</Text>
            </Box>
          </>
        ) : (
          <Text dimColor>└ awaiting result…</Text>
        )}
      </Box>
    </Box>
  );
}

function Footer({
  status,
  verbose,
  toolCount,
}: {
  status: Status;
  verbose: boolean;
  toolCount: number;
}): React.JSX.Element {
  if (status.error) {
    return (
      <Box marginTop={1} flexDirection="column">
        <Text color="red">✗ {status.error}</Text>
        <Text dimColor>Ctrl+O · {verbose ? "hide" : "show"} verbose · {toolCount} tool calls</Text>
      </Box>
    );
  }
  const total = status.inputTokens + status.outputTokens;
  const cost = status.costUSD.toFixed(4);
  const tag = status.done
    ? status.reason === "stop"
      ? "✓ done"
      : `! ${status.reason}`
    : "● running";
  const tagColor = status.done
    ? status.reason === "stop"
      ? "green"
      : "yellow"
    : "cyan";
  return (
    <Box marginTop={1} flexDirection="column">
      <Box>
        <Text color={tagColor} bold>
          {tag}
        </Text>
        <Text dimColor>
          {"  "}step {status.step} · tokens {total} (in {status.inputTokens} / out{" "}
          {status.outputTokens}) · ~${cost}
        </Text>
      </Box>
      <Text dimColor>
        Ctrl+O · {verbose ? "hide" : "show"} verbose · {toolCount} tool calls
      </Text>
    </Box>
  );
}

function handleEvent(
  ev: AgentEvent,
  append: (line: Omit<LogLine, "id">) => void,
  upsertToolCall: (
    id: string,
    patch: Partial<ToolCallRecord> & Pick<ToolCallRecord, "name">,
  ) => void,
  setStatus: (fn: (s: Status) => Status) => void,
): void {
  switch (ev.kind) {
    case "step_start":
      setStatus((s) => ({ ...s, step: ev.step }));
      append({ kind: "info", text: `─── step ${ev.step} ───` });
      break;
    case "text":
      append({ kind: "text", text: ev.text });
      break;
    case "tool_call": {
      const preview = chipPreview(ev.name, ev.input);
      append({
        kind: "tool",
        text: preview ? `◌ ${ev.name}  ${preview}` : `◌ ${ev.name}`,
      });
      upsertToolCall(ev.id, {
        name: ev.name,
        input: ev.input,
        status: "pending",
        startedAt: Date.now(),
      });
      break;
    }
    case "tool_result":
      append({ kind: "tool_result", text: `✓ ${ev.name}` });
      upsertToolCall(ev.id, { name: ev.name, output: ev.output, status: "ok" });
      break;
    case "tool_error":
      append({ kind: "tool_error", text: `✗ ${ev.name}  ${ev.message}` });
      upsertToolCall(ev.id, { name: ev.name, errorMessage: ev.message, status: "error" });
      break;
    case "tool_denied":
      append({ kind: "tool_denied", text: `⊘ ${ev.name}  denied` });
      upsertToolCall(ev.id, { name: ev.name, status: "denied" });
      break;
    case "usage":
      setStatus((s) => ({
        ...s,
        inputTokens: s.inputTokens + ev.inputTokens,
        outputTokens: s.outputTokens + ev.outputTokens,
        costUSD: ev.cumulativeUSD,
      }));
      break;
    case "done":
      setStatus((s) => ({ ...s, done: true, reason: ev.reason }));
      break;
    case "error":
      setStatus((s) => ({ ...s, done: true, error: ev.message }));
      break;
  }
}
