// Ink TUI app — Phase 1 Sprint 2.
// Renders the agent event stream: assistant text, tool_use chips, tool results,
// and a footer showing step / token / cost.
import React, { useEffect, useState } from "react";
import { Box, Static, Text, useApp } from "ink";
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

export function App({ prompt, autoApprove, limits }: AppProps): React.JSX.Element {
  const { exit } = useApp();
  const [lines, setLines] = useState<readonly LogLine[]>([]);
  const [status, setStatus] = useState<Status>(INITIAL_STATUS);

  useEffect(() => {
    let nextId = 0;
    const append = (line: Omit<LogLine, "id">): void => {
      const id = nextId++;
      setLines((prev) => [...prev, { ...line, id }]);
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
          handleEvent(ev, append, setStatus);
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
      <Footer status={status} />
    </Box>
  );
}

function Footer({ status }: { status: Status }): React.JSX.Element {
  if (status.error) {
    return (
      <Box marginTop={1}>
        <Text color="red">✗ {status.error}</Text>
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
    <Box marginTop={1}>
      <Text dimColor>
        [{tag}] step={status.step} tokens={total} (in={status.inputTokens}/out={status.outputTokens}) ~${cost}
      </Text>
    </Box>
  );
}

function handleEvent(
  ev: AgentEvent,
  append: (line: Omit<LogLine, "id">) => void,
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
      break;
    case "tool_result":
      append({ kind: "tool_result", text: `← ${ev.name} ok` });
      break;
    case "tool_error":
      append({ kind: "tool_error", text: `← ${ev.name} ERROR: ${ev.message}` });
      break;
    case "tool_denied":
      append({ kind: "tool_denied", text: `× ${ev.name} denied` });
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
