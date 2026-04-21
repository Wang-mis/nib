// Ink TUI app — Phase 1 Sprint 2.
// Renders the agent event stream inline. Each tool call is shown as a compact
// chip by default (◌/✓/✗/⊘ name  preview); pressing Ctrl+O expands every tool
// call in-place into a full card with input + output + duration.
import React, { useEffect, useState } from "react";
import { Box, Text, useApp, useInput } from "ink";
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

type StreamItem =
  | { kind: "text"; id: number; text: string }
  | { kind: "info"; id: number; text: string }
  | { kind: "error"; id: number; text: string }
  | { kind: "tool"; id: number; toolId: string };

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

// Pick the most identifying argument for a tool — used in the compact chip.
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
  const [items, setItems] = useState<readonly StreamItem[]>([]);
  const [toolsById, setToolsById] = useState<Readonly<Record<string, ToolCallRecord>>>({});
  const [status, setStatus] = useState<Status>(INITIAL_STATUS);
  const [verbose, setVerbose] = useState(false);

  // Ctrl+O toggles the inline verbose details for every tool call.
  useInput((input, key) => {
    if (key.ctrl && (input === "o" || input === "O")) {
      setVerbose((v) => !v);
    }
  });

  useEffect(() => {
    let nextId = 0;
    let currentStep = 0;
    const append = (item: Omit<StreamItem, "id">): void => {
      const id = nextId++;
      setItems((prev) => [...prev, { ...item, id } as StreamItem]);
    };
    const upsertTool = (
      id: string,
      patch: Partial<ToolCallRecord> & Pick<ToolCallRecord, "name">,
    ): void => {
      setToolsById((prev) => {
        const existing = prev[id];
        const finished =
          patch.status === "ok" || patch.status === "error" || patch.status === "denied";
        const finishedAt = finished ? Date.now() : existing?.finishedAt;
        const merged: ToolCallRecord = existing
          ? { ...existing, ...patch, finishedAt }
          : {
              id,
              step: currentStep,
              status: "pending",
              input: undefined,
              startedAt: Date.now(),
              ...patch,
              finishedAt,
            };
        return { ...prev, [id]: merged };
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
          handleEvent(ev, append, upsertTool, setStatus);
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setStatus((s) => ({ ...s, error: message, done: true }));
      } finally {
        process.off("SIGINT", onSig);
        process.off("SIGTERM", onSig);
        setTimeout(() => exit(), 50);
      }
    })();
  }, [prompt, autoApprove, limits, exit]);

  let toolIndex = 0;
  return (
    <Box flexDirection="column">
      {items.map((item) => {
        if (item.kind === "tool") {
          const rec = toolsById[item.toolId];
          if (!rec) return null;
          toolIndex++;
          return verbose ? (
            <ToolCallCard key={item.id} record={rec} index={toolIndex} />
          ) : (
            <ToolCallChip key={item.id} record={rec} />
          );
        }
        if (item.kind === "text") {
          return (
            <Text key={item.id} color="white">
              {item.text}
            </Text>
          );
        }
        if (item.kind === "error") {
          return (
            <Text key={item.id} color="red">
              {item.text}
            </Text>
          );
        }
        return (
          <Text key={item.id} color="gray">
            {item.text}
          </Text>
        );
      })}
      <Footer
        status={status}
        verbose={verbose}
        toolCount={Object.keys(toolsById).length}
      />
    </Box>
  );
}

function ToolCallChip({ record }: { record: ToolCallRecord }): React.JSX.Element {
  const color = colorForStatus(record.status);
  const glyph = STATUS_GLYPH[record.status];
  const preview = chipPreview(record.name, record.input);
  const tail =
    record.status === "error" && record.errorMessage
      ? `  ${truncate(record.errorMessage, 80)}`
      : record.status === "denied"
        ? "  denied"
        : preview
          ? `  ${preview}`
          : "";
  return (
    <Text>
      <Text color={color}>{glyph} </Text>
      <Text color={color}>{record.name}</Text>
      <Text dimColor>{tail}</Text>
    </Text>
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
    <Box
      flexDirection="column"
      marginY={0}
      borderStyle="round"
      borderColor={color}
      paddingX={1}
    >
      {/* Header */}
      <Box>
        <Text color={color} bold>
          {glyph} {String(index).padStart(2, " ")} {record.name}
        </Text>
        <Text dimColor>
          {"  "}step {record.step} · {duration} · {record.status}
        </Text>
      </Box>

      {/* Input */}
      <Text dimColor>┌ input</Text>
      <Box marginLeft={2} flexDirection="column">
        <Text>{prettyJson(record.input)}</Text>
      </Box>

      {/* Result */}
      {record.status === "ok" ? (
        <>
          <Text dimColor>
            └ output{out.meta ? `  (${out.meta})` : ""}
          </Text>
          <Box marginLeft={2}>
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
        <Text dimColor>
          Ctrl+O · {verbose ? "collapse" : "expand"} tool details · {toolCount} tool calls
        </Text>
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
        Ctrl+O · {verbose ? "collapse" : "expand"} tool details · {toolCount} tool calls
      </Text>
    </Box>
  );
}

function handleEvent(
  ev: AgentEvent,
  append: (item: Omit<StreamItem, "id">) => void,
  upsertTool: (
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
    case "tool_call":
      // One item per tool_use; ToolCallChip / ToolCallCard reads the live record.
      append({ kind: "tool", toolId: ev.id });
      upsertTool(ev.id, {
        name: ev.name,
        input: ev.input,
        status: "pending",
        startedAt: Date.now(),
      });
      break;
    case "tool_result":
      upsertTool(ev.id, { name: ev.name, output: ev.output, status: "ok" });
      break;
    case "tool_error":
      upsertTool(ev.id, { name: ev.name, errorMessage: ev.message, status: "error" });
      break;
    case "tool_denied":
      upsertTool(ev.id, { name: ev.name, status: "denied" });
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
