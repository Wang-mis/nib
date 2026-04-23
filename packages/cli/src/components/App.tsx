// Ink TUI app — Phase 1 Sprint 2 + minimal REPL.
// Renders the agent event stream inline. Each tool call is shown as a compact
// chip by default (◌/✓/✗/⊘ name  preview); pressing Ctrl+O expands every tool
// call in-place into a full card with input + output + duration.
//
// REPL: after each turn finishes, returns to a prompt where the user can type
// another message. Conversation history is threaded through `runAgent` via the
// `messages` option so the model sees prior turns. Slash commands:
//   /exit | /quit   exit the REPL
//   /clear          reset conversation + scrollback
import React, { useEffect, useState } from "react";
import { Box, Static, Text, useApp, useInput } from "ink";
import { marked } from "marked";
import { markedTerminal } from "marked-terminal";
import {
  defaultRegistry,
  runAgent,
  VERSION,
  type AgentEvent,
  type AgentLimits,
  type Message,
} from "@nib/core";

// Configure marked once with the terminal renderer (ANSI colors via chalk).
marked.use(
  markedTerminal({
    reflowText: false,
    width: Math.min(process.stdout.columns ?? 100, 120),
    tab: 2,
  }) as Parameters<typeof marked.use>[0],
);

function renderMarkdown(src: string): string {
  try {
    const out = marked.parse(src, { async: false }) as string;
    return out.replace(/\n+$/, "");
  } catch {
    return src;
  }
}

interface AppProps {
  /** Optional first-turn prompt; if empty, the REPL starts idle. */
  prompt: string;
  autoApprove: boolean;
  limits?: Partial<AgentLimits>;
}

type StreamItem =
  | { kind: "text"; id: number; text: string }
  | { kind: "step"; id: number; step: number }
  | { kind: "user"; id: number; text: string }
  | { kind: "error"; id: number; text: string }
  | { kind: "tool"; id: number; toolId: string };

type DistributiveOmit<T, K extends keyof never> = T extends unknown
  ? Omit<T, K>
  : never;
type StreamItemInput = DistributiveOmit<StreamItem, "id">;

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

const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

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

let nextItemId = 0;
function newItemId(): number {
  return nextItemId++;
}

export function App({ prompt, autoApprove, limits }: AppProps): React.JSX.Element {
  const { exit } = useApp();
  const [items, setItems] = useState<readonly StreamItem[]>([]);
  const [toolsById, setToolsById] = useState<Readonly<Record<string, ToolCallRecord>>>({});
  const [status, setStatus] = useState<Status>(INITIAL_STATUS);
  const [verbose, setVerbose] = useState(false);
  const [messages, setMessages] = useState<readonly Message[]>([]);
  const [running, setRunning] = useState(false);
  const [draft, setDraft] = useState("");
  const [turn, setTurn] = useState(0);
  const [pendingPrompt, setPendingPrompt] = useState<string>(prompt);
  const [spinnerTick, setSpinnerTick] = useState(0);
  const [cursorOn, setCursorOn] = useState(true);

  // Spinner ticker — runs only when `running`.
  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => setSpinnerTick((t) => t + 1), 90);
    return () => clearInterval(id);
  }, [running]);

  // Cursor blink — runs only when idle (input visible).
  useEffect(() => {
    if (running) return;
    const id = setInterval(() => setCursorOn((c) => !c), 500);
    return () => clearInterval(id);
  }, [running]);

  useInput((input, key) => {
    if (key.ctrl && (input === "o" || input === "O")) {
      setVerbose((v) => !v);
      return;
    }
    if (running) return;
    if (key.return) {
      const text = draft.trim();
      setDraft("");
      if (text === "") return;
      handleSubmit(text);
      return;
    }
    if (key.backspace || key.delete) {
      setDraft((d) => d.slice(0, -1));
      return;
    }
    if (key.ctrl && (input === "c" || input === "d")) {
      exit();
      return;
    }
    if (key.escape) return;
    if (input && !key.ctrl && !key.meta) {
      setDraft((d) => d + input);
    }
  });

  function appendItem(item: StreamItemInput): void {
    const id = newItemId();
    setItems((prev) => [...prev, { ...item, id } as StreamItem]);
  }

  function handleSubmit(text: string): void {
    if (text === "/exit" || text === "/quit") {
      exit();
      return;
    }
    if (text === "/clear") {
      setItems([]);
      setToolsById({});
      setMessages([]);
      setStatus(INITIAL_STATUS);
      return;
    }
    appendItem({ kind: "user", text });
    setPendingPrompt(text);
    setTurn((t) => t + 1);
  }

  useEffect(() => {
    if (turn === 0 && pendingPrompt === "") return;
    if (pendingPrompt === "") return;

    const promptForTurn = pendingPrompt;
    setRunning(true);
    setStatus(INITIAL_STATUS);

    const controller = new AbortController();
    const onSig = (): void => controller.abort();
    process.on("SIGINT", onSig);
    process.on("SIGTERM", onSig);

    let currentStep = 0;
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

    void (async () => {
      let nextHistory: readonly Message[] = messages;
      try {
        for await (const ev of runAgent({
          prompt: promptForTurn,
          messages,
          registry: defaultRegistry(),
          autoApprove,
          limits,
          signal: controller.signal,
        })) {
          if (ev.kind === "step_start") currentStep = ev.step;
          if (ev.kind === "done") nextHistory = ev.messages;
          handleEvent(ev, appendItem, upsertTool, setStatus);
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setStatus((s) => ({ ...s, error: message, done: true }));
      } finally {
        process.off("SIGINT", onSig);
        process.off("SIGTERM", onSig);
        setMessages(nextHistory);
        setPendingPrompt("");
        setRunning(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [turn]);

  useEffect(() => {
    if (prompt && prompt !== "") {
      appendItem({ kind: "user", text: prompt });
      setTurn((t) => t + 1);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Split items into a "settled" prefix (never re-renders) and a "live" suffix
  // (still updating — only pending tool calls qualify). The settled prefix is
  // handed to Ink's <Static>, which prints each item exactly once and lets the
  // terminal scrollback own it. Without this, every spinner/cursor tick repaints
  // the whole transcript and Ink yanks the viewport back to the top of its frame.
  let committedCount = 0;
  for (const it of items) {
    if (it.kind === "tool") {
      const rec = toolsById[it.toolId];
      if (!rec || rec.status === "pending") break;
    }
    committedCount++;
  }
  const settled = items.slice(0, committedCount);
  const live = items.slice(committedCount);

  // Tool index must be assigned in original order so chips/cards keep their
  // numbering even after migration to <Static>.
  const toolIndexById = new Map<number, number>();
  let runningIdx = 0;
  for (const it of items) {
    if (it.kind === "tool") {
      runningIdx++;
      toolIndexById.set(it.id, runningIdx);
    }
  }

  const renderItem = (item: StreamItem): React.JSX.Element | null => {
    if (item.kind === "tool") {
      const rec = toolsById[item.toolId];
      if (!rec) return null;
      const idx = toolIndexById.get(item.id) ?? 0;
      return verbose ? (
        <ToolCallCard key={item.id} record={rec} index={idx} />
      ) : (
        <ToolCallChip key={item.id} record={rec} />
      );
    }
    if (item.kind === "step") {
      return <StepDivider key={item.id} step={item.step} />;
    }
    if (item.kind === "text") {
      return <AssistantText key={item.id} text={item.text} />;
    }
    if (item.kind === "user") {
      return <UserBubble key={item.id} text={item.text} />;
    }
    return (
      <Text key={item.id} color="red">
        ✗ {item.text}
      </Text>
    );
  };

  return (
    <Box flexDirection="column">
      <Static items={[{ id: -1, kind: "banner" } as const, ...settled]}>
        {(entry) =>
          entry.kind === "banner" ? (
            <Banner key="banner" />
          ) : (
            (renderItem(entry as StreamItem) ?? <Text key={entry.id} />)
          )
        }
      </Static>
      {live.map((it) => renderItem(it))}
      <Footer
        status={status}
        verbose={verbose}
        toolCount={Object.keys(toolsById).length}
        running={running}
        draft={draft}
        spinnerTick={spinnerTick}
        cursorOn={cursorOn}
      />
    </Box>
  );
}

function Banner(): React.JSX.Element {
  return (
    <Box flexDirection="column" marginBottom={1}>
      <Text>
        <Text color="magentaBright" bold>
          {"  ✒  nib"}
        </Text>
        <Text dimColor>{`  v${VERSION} · learning-first claude-code clone`}</Text>
      </Text>
      <Text dimColor>
        {"     "}type your message · /exit · /clear · Ctrl+O for tool details
      </Text>
    </Box>
  );
}

function StepDivider({ step }: { step: number }): React.JSX.Element {
  const cols = Math.max(20, Math.min(process.stdout.columns ?? 80, 200));
  const label = ` step ${step} `;
  const remaining = Math.max(2, cols - label.length);
  const left = Math.floor(remaining / 2);
  const right = remaining - left;
  return (
    <Box marginTop={1}>
      <Text color="blueBright" dimColor>
        {"━".repeat(left)}
      </Text>
      <Text color="blueBright" bold>
        {label}
      </Text>
      <Text color="blueBright" dimColor>
        {"━".repeat(right)}
      </Text>
    </Box>
  );
}

function UserBubble({ text }: { text: string }): React.JSX.Element {
  return (
    <Box marginTop={1}>
      <Text color="magentaBright" bold>
        {"▍ "}
      </Text>
      <Text color="magentaBright">{text}</Text>
    </Box>
  );
}

function AssistantText({ text }: { text: string }): React.JSX.Element {
  return (
    <Box marginTop={1} flexDirection="row">
      <Text color="cyanBright">{"✦ "}</Text>
      <Box flexDirection="column" flexGrow={1}>
        <Text>{renderMarkdown(text)}</Text>
      </Box>
    </Box>
  );
}

function ToolCallChip({ record }: { record: ToolCallRecord }): React.JSX.Element {
  const color = colorForStatus(record.status);
  const glyph = STATUS_GLYPH[record.status];
  const preview = chipPreview(record.name, record.input);
  const tail =
    record.status === "error" && record.errorMessage
      ? truncate(record.errorMessage, 80)
      : record.status === "denied"
        ? "denied"
        : preview;
  return (
    <Text>
      <Text color={color}>{`  ${glyph} `}</Text>
      <Text color={color} bold>
        {record.name}
      </Text>
      {tail ? (
        <>
          <Text dimColor>{"  "}</Text>
          <Text dimColor>{tail}</Text>
        </>
      ) : null}
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
      <Box>
        <Text color={color} bold>
          {glyph} #{String(index).padStart(2, "0")} {record.name}
        </Text>
        <Text dimColor>
          {"  "}step {record.step} · {duration} · {record.status}
        </Text>
      </Box>

      <Text dimColor>┌ input</Text>
      <Box marginLeft={2} flexDirection="column">
        <Text>{prettyJson(record.input)}</Text>
      </Box>

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

function StatusPill({
  running,
  status,
  spinnerTick,
}: {
  running: boolean;
  status: Status;
  spinnerTick: number;
}): React.JSX.Element {
  if (status.error) {
    return (
      <Text color="red" bold>
        {" ✗ error "}
      </Text>
    );
  }
  if (running) {
    const frame = SPINNER_FRAMES[spinnerTick % SPINNER_FRAMES.length] ?? "⠋";
    return (
      <Text color="cyanBright" bold>
        {` ${frame} thinking `}
      </Text>
    );
  }
  if (status.done) {
    if (status.reason === "stop") {
      return (
        <Text color="greenBright" bold>
          {" ✓ done "}
        </Text>
      );
    }
    return (
      <Text color="yellow" bold>
        {` ! ${status.reason ?? "stopped"} `}
      </Text>
    );
  }
  return (
    <Text color="gray" bold>
      {" ○ ready "}
    </Text>
  );
}

function Footer({
  status,
  verbose,
  toolCount,
  running,
  draft,
  spinnerTick,
  cursorOn,
}: {
  status: Status;
  verbose: boolean;
  toolCount: number;
  running: boolean;
  draft: string;
  spinnerTick: number;
  cursorOn: boolean;
}): React.JSX.Element {
  const total = status.inputTokens + status.outputTokens;
  const cost = status.costUSD.toFixed(4);

  return (
    <Box marginTop={1} flexDirection="column">
      {/* Status row */}
      <Box>
        <StatusPill running={running} status={status} spinnerTick={spinnerTick} />
        <Text dimColor>{"  "}</Text>
        <Text dimColor>
          step {status.step} · tokens{" "}
        </Text>
        <Text>{total}</Text>
        <Text dimColor>
          {" "}(in {status.inputTokens} · out {status.outputTokens}) · ~$
        </Text>
        <Text>{cost}</Text>
        <Text dimColor>{`  ·  ${toolCount} tool calls`}</Text>
      </Box>

      {status.error ? (
        <Box marginTop={0}>
          <Text color="red">{`  ${status.error}`}</Text>
        </Box>
      ) : null}

      {/* Hint row */}
      <Box>
        <Text dimColor>
          {"  "}
          {verbose ? "Ctrl+O collapse" : "Ctrl+O expand"} · /clear · /exit
        </Text>
      </Box>

      {/* Input row — only when idle */}
      {!running ? (
        <Box
          marginTop={1}
          borderStyle="round"
          borderColor={status.error ? "red" : "magenta"}
          paddingX={1}
        >
          <Text color="magentaBright" bold>
            {"› "}
          </Text>
          {draft.length > 0 ? (
            <Text>{draft}</Text>
          ) : (
            <Text dimColor>say something… (Enter to send, /exit to quit)</Text>
          )}
          {draft.length > 0 ? (
            <Text color="magentaBright">{cursorOn ? "▎" : " "}</Text>
          ) : null}
        </Box>
      ) : null}
    </Box>
  );
}

function handleEvent(
  ev: AgentEvent,
  append: (item: StreamItemInput) => void,
  upsertTool: (
    id: string,
    patch: Partial<ToolCallRecord> & Pick<ToolCallRecord, "name">,
  ) => void,
  setStatus: (fn: (s: Status) => Status) => void,
): void {
  switch (ev.kind) {
    case "step_start":
      setStatus((s) => ({ ...s, step: ev.step }));
      append({ kind: "step", step: ev.step });
      break;
    case "text":
      append({ kind: "text", text: ev.text });
      break;
    case "tool_call":
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
