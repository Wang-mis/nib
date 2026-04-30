// Ink TUI app — Phase 1 Sprint 2 + minimal REPL.
// Renders the agent event stream inline. Each tool call is always rendered as
// a full card with input + output + duration. There is no chip/card toggle —
// detailed info is the only mode.
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
  resolveModel,
  runAgent,
  unifiedDiff,
  VERSION,
  type AgentEvent,
  type AgentLimits,
  type DiffHunk,
  type DiffLine,
  type Message,
  type UnifiedDiff,
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

function prettyJson(v: unknown): string {
  if (v === undefined) return "(none)";
  try {
    return JSON.stringify(v, null, 2);
  } catch {
    return String(v);
  }
}

/**
 * Format JSON-ish value with one property per line. Each value is stringified
 * inline and truncated to `maxValueLen` chars to keep tool cards compact.
 * Wrapped in a fenced code block (```json) so markdown renderers (or just
 * stylistic alignment) display it as a code section.
 */
function formatJsonCompact(v: unknown, maxValueLen = 100): string {
  const lines: string[] = ["```json"];
  if (v === undefined || v === null) {
    lines.push(String(v ?? "(none)"));
  } else if (typeof v !== "object") {
    lines.push(truncateOneLine(JSON.stringify(v), maxValueLen));
  } else if (Array.isArray(v)) {
    lines.push("[");
    for (const item of v) {
      lines.push("  " + truncateOneLine(JSON.stringify(item), maxValueLen) + ",");
    }
    lines.push("]");
  } else {
    lines.push("{");
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      const valStr = truncateOneLine(JSON.stringify(val), maxValueLen);
      lines.push(`  ${JSON.stringify(k)}: ${valStr},`);
    }
    lines.push("}");
  }
  lines.push("```");
  return lines.join("\n");
}

function truncateOneLine(s: string | undefined, max: number): string {
  if (s === undefined) return "undefined";
  // Collapse newlines so each property stays on one line.
  const flat = s.replace(/\s*\n\s*/g, " ");
  return flat.length > max ? flat.slice(0, max - 1) + "…" : flat;
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
  const [messages, setMessages] = useState<readonly Message[]>([]);
  const [running, setRunning] = useState(false);
  const [draft, setDraft] = useState("");
  const [turn, setTurn] = useState(0);
  const [pendingPrompt, setPendingPrompt] = useState<string>(prompt);
  const [spinnerTick, setSpinnerTick] = useState(0);

  // Spinner ticker — runs only when `running`.
  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => setSpinnerTick((t) => t + 1), 90);
    return () => clearInterval(id);
  }, [running]);

  useInput((input, key) => {
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

  // Inline mode: completed tools settle into <Static>, which writes them to
  // terminal scrollback exactly once and never re-renders them. This is what
  // lets the mouse wheel work normally — Ink isn't fighting the terminal for
  // the screen. A tool only settles after it's *finished* (status !== pending).
  let committedCount = 0;
  for (const it of items) {
    if (it.kind === "tool") {
      const rec = toolsById[it.toolId];
      if (!rec || rec.status === "pending") break;
    }
    committedCount++;
  }
  const settledRaw = items.slice(0, committedCount);
  const live = items.slice(committedCount);

  // Pre-filter trailing/consecutive `step` dividers from the settled stream.
  // `<Static>` doesn't expose an index callback, so we drop dividers here
  // whenever the next item is also a `step` or there is no next item.
  const settled: StreamItem[] = [];
  for (let i = 0; i < settledRaw.length; i++) {
    const it = settledRaw[i];
    if (!it) continue;
    if (it.kind === "step") {
      const next = settledRaw[i + 1] ?? live[0];
      if (!next || next.kind === "step") continue;
    }
    settled.push(it);
  }

  // Tool index must be assigned in original order so cards keep their
  // numbering across re-renders.
  const toolIndexById = new Map<string, number>();
  let runningIdx = 0;
  for (const it of items) {
    if (it.kind === "tool") {
      runningIdx++;
      toolIndexById.set(it.toolId, runningIdx);
    }
  }

  const renderItem = (item: StreamItem, idxInList?: number, list?: readonly StreamItem[]): React.JSX.Element | null => {
    if (item.kind === "tool") {
      const rec = toolsById[item.toolId];
      if (!rec) return null;
      const idx = toolIndexById.get(item.toolId) ?? 0;
      return <ToolCallCard key={item.id} record={rec} index={idx} />;
    }
    if (item.kind === "step") {
      // Suppress step dividers that have no content after them yet, or that
      // immediately follow another step divider. The divider only appears
      // once real output for the new step lands.
      if (list && idxInList !== undefined) {
        const next = list[idxInList + 1];
        if (!next || next.kind === "step") return null;
      }
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
      {live.map((it, i) => renderItem(it, i, live))}
      <Footer
        status={status}
        toolCount={Object.keys(toolsById).length}
        running={running}
        draft={draft}
        spinnerTick={spinnerTick}
      />
    </Box>
  );
}

function Banner(): React.JSX.Element {
  const cols = Math.max(60, Math.min(process.stdout.columns ?? 80, 200));
  const GOLD = "#E0B872"; // warm muted gold
  const GOLD_BRIGHT = "#F5C76A"; // amber highlight
  const model = resolveModel({ role: "main" });
  const cwd = process.cwd();
  const cwdShort = cwd.length > 50 ? "…" + cwd.slice(cwd.length - 49) : cwd;
  return (
    <Box flexDirection="column" marginBottom={1} width={cols}>
      <Box
        borderStyle="round"
        borderColor={GOLD}
        paddingX={2}
        paddingY={0}
        flexDirection="row"
        width={cols}
      >
        {/* Left: Nib wordmark */}
        <Box flexDirection="column" flexShrink={0}>
          <Text color={GOLD_BRIGHT} bold>{"███╗  ██╗ ██╗ ██████╗ "}</Text>
          <Text color={GOLD_BRIGHT} bold>{"████╗ ██║ ██║ ██╔══██╗"}</Text>
          <Text color={GOLD_BRIGHT} bold>{"██╔██╗██║ ██║ ██████╔╝"}</Text>
          <Text color={GOLD_BRIGHT} bold>{"██║╚████║ ██║ ██╔══██╗"}</Text>
          <Text color={GOLD_BRIGHT} bold>{"██║ ╚███║ ██║ ██████╔╝"}</Text>
          <Text color={GOLD_BRIGHT} bold>{"╚═╝  ╚══╝ ╚═╝ ╚═════╝ "}</Text>
        </Box>
        {/* Vertical separator */}
        <Box flexDirection="column" marginX={2} flexShrink={0}>
          <Text color={GOLD} dimColor>{"│"}</Text>
          <Text color={GOLD} dimColor>{"│"}</Text>
          <Text color={GOLD} dimColor>{"│"}</Text>
          <Text color={GOLD} dimColor>{"│"}</Text>
          <Text color={GOLD} dimColor>{"│"}</Text>
          <Text color={GOLD} dimColor>{"│"}</Text>
        </Box>
        {/* Right: meta info */}
        <Box flexDirection="column" flexGrow={1}>
          <Box>
            <Text color={GOLD_BRIGHT} bold>{"Nib"}</Text>
            <Text dimColor>{"  learning-first claude-code clone"}</Text>
          </Box>
          <Box>
            <Text color={GOLD}>{"version  "}</Text>
            <Text>{`v${VERSION}`}</Text>
          </Box>
          <Box>
            <Text color={GOLD}>{"model    "}</Text>
            <Text>{model}</Text>
          </Box>
          <Box>
            <Text color={GOLD}>{"cwd      "}</Text>
            <Text dimColor>{cwdShort}</Text>
          </Box>
          <Box marginTop={1}>
            <Text dimColor>{"› type a message  "}</Text>
            <Text color={GOLD_BRIGHT}>/exit</Text>
            <Text dimColor>{"  "}</Text>
            <Text color={GOLD_BRIGHT}>/clear</Text>
            <Text dimColor>{"  "}</Text>
            <Text color={GOLD_BRIGHT}>Ctrl+C</Text>
            <Text dimColor>{" quit"}</Text>
          </Box>
        </Box>
      </Box>
    </Box>
  );
}

function StepDivider(_props: { step: number }): React.JSX.Element {
  const cols = Math.max(20, Math.min(process.stdout.columns ?? 80, 200));
  return (
    <Box marginTop={1}>
      <Text color="#E0B872" dimColor>
        {"─".repeat(cols)}
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
  const diff = computeEditDiff(record);

  return (
    <Box flexDirection="column" marginTop={1}>
      <Box>
        <Text color={color} bold>
          {glyph} {record.name}
        </Text>
        <Text dimColor>
          {"  "}#{String(index).padStart(2, "0")} · {duration} · {record.status}
        </Text>
      </Box>

      <Box marginLeft={2} flexDirection="column">
        <Text dimColor>input</Text>
        <Box marginLeft={2} flexDirection="column">
          <Text>{renderMarkdown(formatJsonCompact(record.input))}</Text>
        </Box>

        {record.status === "ok" && diff ? (
          <>
            <Text dimColor>
              {`diff  (${diff.added} added, ${diff.removed} removed, ${diff.hunks.length} ${diff.hunks.length === 1 ? "hunk" : "hunks"})`}
            </Text>
            <Box marginLeft={2} flexDirection="column">
              <DiffView diff={diff} />
            </Box>
          </>
        ) : record.status === "ok" ? (
          <>
            <Text dimColor>{`output${out.meta ? `  (${out.meta})` : ""}`}</Text>
            <Box marginLeft={2} flexDirection="column">
              <Text>{renderMarkdown(formatJsonCompact(record.output))}</Text>
            </Box>
          </>
        ) : record.status === "error" ? (
          <>
            <Text dimColor>error</Text>
            <Box marginLeft={2}>
              <Text color="red">{record.errorMessage ?? "(no message)"}</Text>
            </Box>
          </>
        ) : record.status === "denied" ? (
          <>
            <Text dimColor>result</Text>
            <Box marginLeft={2}>
              <Text color="yellow">denied by user</Text>
            </Box>
          </>
        ) : (
          <Text dimColor>awaiting result…</Text>
        )}
      </Box>
    </Box>
  );
}

function computeEditDiff(record: ToolCallRecord): UnifiedDiff | null {
  if (record.name !== "edit_file") return null;
  if (record.status !== "ok") return null;
  const out = record.output as
    | { oldContent?: unknown; newContent?: unknown; path?: unknown }
    | null
    | undefined;
  if (!out || typeof out !== "object") return null;
  const oldContent = typeof out.oldContent === "string" ? out.oldContent : null;
  const newContent = typeof out.newContent === "string" ? out.newContent : null;
  const path = typeof out.path === "string" ? out.path : "";
  if (oldContent === null || newContent === null) return null;
  return unifiedDiff(oldContent, newContent, path);
}

function DiffView({ diff }: { diff: UnifiedDiff }): React.JSX.Element {
  if (diff.hunks.length === 0) {
    return <Text dimColor>(no changes)</Text>;
  }
  return (
    <Box flexDirection="column">
      {diff.hunks.map((hunk, i) => (
        <DiffHunkView key={i} hunk={hunk} index={i} total={diff.hunks.length} />
      ))}
    </Box>
  );
}

function DiffHunkView({
  hunk,
  index,
  total,
}: {
  hunk: DiffHunk;
  index: number;
  total: number;
}): React.JSX.Element {
  const header = `@@ -${hunk.oldStart},${hunk.oldCount} +${hunk.newStart},${hunk.newCount} @@`;
  return (
    <Box flexDirection="column" marginTop={index === 0 ? 0 : 1}>
      <Text color="cyan" dimColor>
        {header}
        {total > 1 ? `  (hunk ${index + 1}/${total})` : ""}
      </Text>
      {hunk.lines.map((line, i) => (
        <DiffLineView key={i} line={line} />
      ))}
    </Box>
  );
}

function DiffLineView({ line }: { line: DiffLine }): React.JSX.Element {
  const oldNum = formatLineNum(line.oldLine);
  const newNum = formatLineNum(line.newLine);
  if (line.op === "add") {
    return (
      <Text>
        <Text dimColor>{`${oldNum} ${newNum} `}</Text>
        <Text color="green">{`+ ${line.text}`}</Text>
      </Text>
    );
  }
  if (line.op === "remove") {
    return (
      <Text>
        <Text dimColor>{`${oldNum} ${newNum} `}</Text>
        <Text color="red">{`- ${line.text}`}</Text>
      </Text>
    );
  }
  return (
    <Text dimColor>
      {`${oldNum} ${newNum}   ${line.text}`}
    </Text>
  );
}

function formatLineNum(n: number | null): string {
  return (n === null ? "" : String(n)).padStart(4, " ");
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
  toolCount,
  running,
  draft,
  spinnerTick,
}: {
  status: Status;
  toolCount: number;
  running: boolean;
  draft: string;
  spinnerTick: number;
}): React.JSX.Element {
  const total = status.inputTokens + status.outputTokens;
  const cost = status.costUSD.toFixed(4);
  const cols = Math.max(60, Math.min(process.stdout.columns ?? 80, 200));
  const GOLD = "#E0B872";
  const GOLD_BRIGHT = "#F5C76A";
  const borderColor = status.error ? "red" : GOLD;

  return (
    <Box marginTop={1} flexDirection="column" width={cols}>
      {/* Input box — pinned just above the status bar */}
      {!running ? (
        <Box
          borderStyle="round"
          borderColor={borderColor}
          paddingX={1}
          width={cols}
        >
          <Text color={GOLD_BRIGHT} bold>{"› "}</Text>
          {draft.length > 0 ? (
            <>
              <Text>{draft}</Text>
              <Text color={GOLD_BRIGHT}>{"▎"}</Text>
            </>
          ) : (
            <>
              <Text color={GOLD_BRIGHT}>{"▎"}</Text>
              <Text dimColor>{" say something… (Enter to send · /exit to quit)"}</Text>
            </>
          )}
        </Box>
      ) : (
        <Box
          borderStyle="round"
          borderColor={GOLD}
          paddingX={1}
          width={cols}
        >
          <Text color={GOLD} dimColor>
            {SPINNER_FRAMES[spinnerTick % SPINNER_FRAMES.length]}
          </Text>
          <Text dimColor>{"  thinking…  press Ctrl+C to interrupt"}</Text>
        </Box>
      )}

      {/* Status bar */}
      <Box>
        <StatusPill running={running} status={status} spinnerTick={spinnerTick} />
        <Text dimColor>{"  "}</Text>
        <Text color={GOLD}>step </Text>
        <Text>{status.step}</Text>
        <Text dimColor>{"  ·  "}</Text>
        <Text color={GOLD}>tokens </Text>
        <Text>{total}</Text>
        <Text dimColor>{` (in ${status.inputTokens} · out ${status.outputTokens})  ·  `}</Text>
        <Text color={GOLD}>cost </Text>
        <Text>{`$${cost}`}</Text>
        <Text dimColor>{`  ·  `}</Text>
        <Text color={GOLD}>tools </Text>
        <Text>{toolCount}</Text>
      </Box>

      {status.error ? (
        <Box>
          <Text color="red">{`  ${status.error}`}</Text>
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
