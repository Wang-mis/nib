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

function shortJson(v: unknown): string {
  try {
    const s = JSON.stringify(v);
    return s.length > 120 ? s.slice(0, 117) + "..." : s;
  } catch {
    return String(v);
  }
}

function prettyJson(v: unknown): string {
  try {
    return JSON.stringify(v, null, 2);
  } catch {
    return String(v);
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
              ...patch,
            },
          ];
        }
        const next = [...prev];
        next[idx] = { ...next[idx]!, ...patch };
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
  return (
    <Box flexDirection="column" marginTop={1} borderStyle="round" borderColor="gray" paddingX={1}>
      <Text bold>Tool calls (verbose)</Text>
      {toolCalls.length === 0 ? (
        <Text dimColor>(no tool calls yet)</Text>
      ) : (
        toolCalls.map((rec) => (
          <Box key={rec.id} flexDirection="column" marginTop={1}>
            <Text>
              <Text dimColor>[step {rec.step}] </Text>
              <Text color={colorForStatus(rec.status)} bold>
                {rec.name}
              </Text>
              <Text dimColor> #{rec.id} </Text>
              <Text color={colorForStatus(rec.status)}>{rec.status}</Text>
            </Text>
            <Text dimColor>input:</Text>
            <Text>{prettyJson(rec.input)}</Text>
            {rec.status === "ok" ? (
              <>
                <Text dimColor>output:</Text>
                <Text>{prettyJson(rec.output)}</Text>
              </>
            ) : null}
            {rec.status === "error" ? (
              <Text color="red">error: {rec.errorMessage}</Text>
            ) : null}
            {rec.status === "denied" ? <Text color="yellow">denied by user</Text> : null}
          </Box>
        ))
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
        <Text dimColor>Ctrl+O: toggle verbose ({toolCount} tool calls)</Text>
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
  return (
    <Box marginTop={1} flexDirection="column">
      <Text dimColor>
        [{tag}] step={status.step} tokens={total} (in={status.inputTokens}/out={status.outputTokens}) ~${cost}
      </Text>
      <Text dimColor>
        Ctrl+O: {verbose ? "hide" : "show"} verbose ({toolCount} tool calls)
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
    case "tool_call":
      append({ kind: "tool", text: `→ ${ev.name}(${shortJson(ev.input)})` });
      upsertToolCall(ev.id, { name: ev.name, input: ev.input, status: "pending" });
      break;
    case "tool_result":
      append({ kind: "tool_result", text: `← ${ev.name} ok` });
      upsertToolCall(ev.id, { name: ev.name, output: ev.output, status: "ok" });
      break;
    case "tool_error":
      append({ kind: "tool_error", text: `← ${ev.name} ERROR: ${ev.message}` });
      upsertToolCall(ev.id, { name: ev.name, errorMessage: ev.message, status: "error" });
      break;
    case "tool_denied":
      append({ kind: "tool_denied", text: `× ${ev.name} denied` });
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
