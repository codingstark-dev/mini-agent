import React, { useCallback, useState } from "react";
import { Box, Text, render, useApp, useInput } from "ink";

import {
  runAgent,
  type AgentEvent,
  type ConversationTurn,
} from "../agent/run-agent.js";
import { providerLabel as getProviderLabel, type ProviderName } from "../providers/create.js";
import type { OpenRouterModel } from "../providers/openrouter-models.js";
import type { Provider } from "../providers/types.js";
import {
  createSession,
  redoSession,
  rewindSession,
  SessionStore,
  type AgentSession,
  type SessionTurn,
} from "../session/session-store.js";
import type { SkillCatalog } from "../skills/discovery.js";
import { ChoicePicker, type Choice } from "./choice-picker.js";
import { parseSlashCommand, type SlashCommand } from "./commands.js";
import { ModelPicker } from "./model-picker.js";

interface Theme {
  accent: string;
  answer: string;
  muted: string;
  prompt: string;
}

const themes: Record<string, Theme> = {
  default: { accent: "cyan", answer: "white", muted: "gray", prompt: "green" },
  mono: { accent: "white", answer: "white", muted: "gray", prompt: "white" },
};

type PickerState =
  | { kind: "history"; choices: Choice[] }
  | { kind: "rewind"; choices: Choice[] };

interface AppProperties {
  catalog: SkillCatalog;
  provider: Provider;
  providerName: ProviderName;
  providerLabel: string;
  model: string;
  createProvider?: (provider: ProviderName, model: string) => Provider;
  loadModels?: (signal: AbortSignal) => Promise<OpenRouterModel[]>;
  maxSubagents: number;
  sessionStore?: SessionStore;
  theme: Theme;
}

const uiCommands = new Set([
  "activity",
  "clear",
  "continue",
  "exit",
  "help",
  "history",
  "model",
  "models",
  "new",
  "quit",
  "redo",
  "resume",
  "rewind",
  "sessions",
  "skills",
  "status",
  "thinking",
  "undo",
]);

function activityLabel(event: AgentEvent): string {
  switch (event.type) {
    case "model_request":
      return `model request ${event.turn}`;
    case "model_response":
      return `model ${event.stopReason.replaceAll("_", " ")}`;
    case "skill_activated":
      return `loaded ${event.name}`;
    case "resource_read":
      return `read ${event.skill}/${event.path}`;
    case "subagent_started":
      return `delegated to ${event.role}`;
    case "subagent_completed":
      return `${event.role} subagent complete`;
    case "subagent_failed":
      return `${event.role} subagent failed`;
    case "complete":
      return `complete in ${event.turns} call${event.turns === 1 ? "" : "s"}`;
  }
}

function sessionHistory(turns: SessionTurn[]): ConversationTurn[] {
  return turns.map((turn) => ({ prompt: turn.prompt, answer: turn.answer }));
}

function helpText(): string {
  return [
    "/model [id]  choose or set a model",
    "/history     resume a saved session",
    "/rewind      return to an earlier turn",
    "/undo        remove the latest turn",
    "/redo        restore rewound turns",
    "/new         start a new session",
    "/skills      list available skills",
    "/status      show session details",
    "/activity    show or hide activity",
    "/clear       clear this conversation",
    "/exit        close the agent",
  ].join("\n");
}

function App({
  catalog,
  provider: initialProvider,
  providerName: initialProviderName,
  providerLabel: initialProviderLabel,
  model: initialModel,
  createProvider,
  loadModels,
  maxSubagents,
  sessionStore,
  theme,
}: AppProperties): React.JSX.Element {
  const { exit } = useApp();
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [provider, setProvider] = useState(initialProvider);
  const [providerName, setProviderName] = useState(initialProviderName);
  const [providerLabel, setProviderLabel] = useState(initialProviderLabel);
  const [model, setModel] = useState(initialModel);
  const [session, setSession] = useState(() => createSession(initialProviderName, initialModel));
  const [turns, setTurns] = useState<SessionTurn[]>([]);
  const [liveActivity, setLiveActivity] = useState<AgentEvent[]>([]);
  const [showActivity, setShowActivity] = useState(true);
  const [modelPickerOpen, setModelPickerOpen] = useState(false);
  const [picker, setPicker] = useState<PickerState>();
  const [panel, setPanel] = useState("");
  const [notice, setNotice] = useState("");

  const canPickModels = providerName === "openrouter" && Boolean(loadModels && createProvider);
  const closePicker = useCallback(() => {
    setModelPickerOpen(false);
    setPicker(undefined);
  }, []);

  async function saveSession(next: AgentSession): Promise<void> {
    setSession(next);
    setTurns(next.turns);
    if (sessionStore) await sessionStore.save(next);
  }

  async function switchModel(selectedModel: string): Promise<void> {
    if (!createProvider) return;
    try {
      const nextProvider = createProvider(providerName, selectedModel);
      const nextSession = { ...session, model: selectedModel, updatedAt: new Date().toISOString() };
      setProvider(nextProvider);
      setModel(selectedModel);
      await saveSession(nextSession);
      setNotice(`Switched to ${selectedModel}`);
      setPanel("");
      closePicker();
    } catch (error) {
      setPanel(error instanceof Error ? error.message : String(error));
    }
  }

  async function resumeSession(id: string): Promise<void> {
    if (!sessionStore || !createProvider) {
      setPanel("Session history is unavailable in this build.");
      return;
    }
    try {
      const saved = await sessionStore.load(id);
      const nextProvider = createProvider(saved.provider, saved.model);
      setProvider(nextProvider);
      setProviderName(saved.provider);
      setProviderLabel(getProviderLabel(saved.provider));
      setModel(saved.model);
      setSession(saved);
      setTurns(saved.turns);
      setNotice(`Resumed ${saved.id}`);
      setPanel("");
      closePicker();
    } catch (error) {
      setPanel(error instanceof Error ? error.message : String(error));
    }
  }

  async function openHistory(): Promise<void> {
    if (!sessionStore) {
      setPanel("Session history is unavailable in this build.");
      return;
    }
    const summaries = await sessionStore.list();
    setPicker({
      kind: "history",
      choices: summaries.map((summary) => ({
        id: summary.id,
        label: summary.title,
        detail: `${summary.id} · ${summary.provider}/${summary.model} · ${summary.turnCount} turns`,
      })),
    });
    setPanel("");
  }

  function rewindChoices(): Choice[] {
    if (turns.length === 0) return [];
    return [
      { id: "0", label: "Start of session", detail: "remove every conversation turn" },
      ...turns.slice(0, -1).map((turn, index) => ({
        id: String(index + 1),
        label: `After turn ${index + 1}`,
        detail: turn.prompt.replaceAll(/\s+/g, " ").slice(0, 60),
      })),
    ].reverse();
  }

  async function applyRewind(keepTurns: number): Promise<void> {
    try {
      const removed = turns.slice(keepTurns);
      const next = rewindSession(session, keepTurns);
      await saveSession(next);
      setInput(removed[0]?.prompt ?? "");
      setNotice(`Rewound ${removed.length} conversation turn${removed.length === 1 ? "" : "s"}`);
      setPanel("Conversation context was rewound. No files were changed.");
      closePicker();
    } catch (error) {
      setPanel(error instanceof Error ? error.message : String(error));
    }
  }

  async function newSession(): Promise<void> {
    const next = createSession(providerName, model);
    setSession(next);
    setTurns([]);
    setInput("");
    setPanel("");
    setNotice(`New session ${next.id}`);
  }

  async function runCommand(command: SlashCommand): Promise<void> {
    switch (command.name) {
      case "help":
        setPanel(helpText());
        return;
      case "model":
      case "models":
        if (command.argument) await switchModel(command.argument);
        else if (canPickModels) setModelPickerOpen(true);
        else setPanel("The searchable model picker is available with OpenRouter. Use /model <id> to switch directly.");
        return;
      case "history":
      case "sessions":
      case "continue":
        await openHistory();
        return;
      case "resume":
        if (command.argument) await resumeSession(command.argument);
        else await openHistory();
        return;
      case "rewind":
        if (command.argument) {
          const removeCount = Number(command.argument);
          if (!Number.isInteger(removeCount) || removeCount < 1 || removeCount > turns.length) {
            setPanel(`Choose a number from 1 to ${turns.length}.`);
            return;
          }
          await applyRewind(turns.length - removeCount);
        } else {
          setPicker({ kind: "rewind", choices: rewindChoices() });
        }
        return;
      case "undo":
        if (turns.length === 0) setPanel("There is no turn to undo.");
        else await applyRewind(turns.length - 1);
        return;
      case "redo":
        try {
          const next = redoSession(session);
          await saveSession(next);
          setInput("");
          setNotice(`Restored ${next.turns.length - turns.length} conversation turn${next.turns.length - turns.length === 1 ? "" : "s"}`);
          setPanel("");
        } catch (error) {
          setPanel(error instanceof Error ? error.message : String(error));
        }
        return;
      case "clear":
        await applyRewind(0);
        setInput("");
        return;
      case "new":
        await newSession();
        return;
      case "skills":
        setPanel(catalog.skills.map((skill) => skill.name).join(" · ") || "No skills found.");
        return;
      case "status":
        setPanel(`session ${session.id}\n${providerLabel} · ${model}\n${turns.length} turns · ${catalog.skills.length} skills`);
        return;
      case "activity":
      case "thinking":
        setShowActivity((current) => !current);
        setPanel("Activity shows provider and tool events, not hidden model thoughts.");
        return;
      case "exit":
      case "quit":
        exit();
        return;
    }
  }

  async function submit(): Promise<void> {
    const prompt = input.trim();
    if (!prompt || busy) return;
    const command = parseSlashCommand(prompt);
    if (command && uiCommands.has(command.name)) {
      setInput("");
      await runCommand(command);
      return;
    }
    if (command && !catalog.skills.some((skill) => skill.name === command.name)) {
      setInput("");
      setPanel(`Unknown command: /${command.name}. Type /help for available commands.`);
      return;
    }

    setInput("");
    setBusy(true);
    setPanel("");
    setNotice("");
    const activity: AgentEvent[] = [];
    setLiveActivity([]);
    try {
      const result = await runAgent({
        prompt,
        history: sessionHistory(turns),
        catalog,
        provider,
        maxSubagents,
        onEvent: (event) => {
          activity.push(event);
          setLiveActivity([...activity]);
        },
      });
      const timestamp = new Date().toISOString();
      const turn: SessionTurn = {
        id: `${session.id}-${turns.length + 1}`,
        prompt,
        answer: result.text,
        activations: result.activations,
        activity,
        createdAt: timestamp,
      };
      const { redoTurns: _discardedRedo, ...committedSession } = session;
      await saveSession({
        ...committedSession,
        provider: providerName,
        model,
        updatedAt: timestamp,
        turns: [...turns, turn],
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setPanel(`Run failed: ${message}`);
    } finally {
      setBusy(false);
      setLiveActivity([]);
    }
  }

  async function selectChoice(id: string): Promise<void> {
    if (picker?.kind === "history") await resumeSession(id);
    if (picker?.kind === "rewind") await applyRewind(Number(id));
  }

  useInput((character, key) => {
    if (key.ctrl && character === "c") {
      exit();
      return;
    }
    if (busy || modelPickerOpen || picker) return;
    if (key.ctrl && character === "p" && canPickModels) {
      setModelPickerOpen(true);
      return;
    }
    if (key.ctrl && character === "r") {
      setPicker({ kind: "rewind", choices: rewindChoices() });
      return;
    }
    if (key.return) {
      void submit();
      return;
    }
    if (key.backspace || key.delete) {
      setInput((current) => [...current].slice(0, -1).join(""));
      return;
    }
    if (!key.ctrl && !key.meta && character) setInput((current) => current + character);
  });

  const activeSkills = [...new Set(turns.flatMap((turn) => turn.activations))];
  const latestActivity = liveActivity.at(-1);

  return (
    <Box flexDirection="column" paddingX={1}>
      <Box gap={1}>
        <Text bold color={theme.accent}>mini-agent</Text>
        <Text color={theme.muted}>{providerLabel} · {model}</Text>
        <Text color={theme.muted}>session {session.id}</Text>
      </Box>

      {notice && <Text color={theme.accent}>{notice}</Text>}
      {panel && (
        <Box borderStyle="single" borderColor={theme.muted} paddingX={1}>
          <Text color={theme.muted}>{panel}</Text>
        </Box>
      )}
      {activeSkills.length > 0 && (
        <Text color={theme.accent}>active: {activeSkills.join(", ")}</Text>
      )}

      <Box flexDirection="column" marginTop={1}>
        {turns.map((turn) => (
          <Box key={turn.id} flexDirection="column" marginBottom={1}>
            <Text color={theme.prompt}>❯ {turn.prompt}</Text>
            {showActivity && turn.activity.length > 0 && (
              <Text color={theme.muted}>  {turn.activity.map(activityLabel).join(" → ")}</Text>
            )}
            <Text color={theme.answer}>{turn.answer}</Text>
          </Box>
        ))}
      </Box>

      {modelPickerOpen && loadModels ? (
        <ModelPicker
          accent={theme.accent}
          currentModel={model}
          loadModels={loadModels}
          muted={theme.muted}
          onCancel={closePicker}
          onSelect={(selected) => { void switchModel(selected); }}
        />
      ) : picker ? (
        <ChoicePicker
          accent={theme.accent}
          choices={picker.choices}
          emptyMessage={picker.kind === "history" ? "No saved sessions." : "No turns to rewind."}
          muted={theme.muted}
          onCancel={closePicker}
          onSelect={(id) => { void selectChoice(id); }}
          title={picker.kind === "history" ? "Session history" : "Rewind conversation"}
        />
      ) : (
        <>
          {busy && latestActivity && (
            <Text color={theme.accent}>◌ {activityLabel(latestActivity)}</Text>
          )}
          <Box>
            <Text color={theme.prompt}>❯ </Text>
            <Text>{busy ? "working…" : input}</Text>
            {!busy && <Text inverse> </Text>}
          </Box>
          <Text color={theme.muted}>
            /help commands{canPickModels ? " · Ctrl+P models" : ""} · Ctrl+R rewind · Ctrl+C exit
          </Text>
        </>
      )}
    </Box>
  );
}

export interface InteractiveOptions {
  catalog: SkillCatalog;
  provider: Provider;
  providerName: ProviderName;
  providerLabel: string;
  model: string;
  createProvider?: (provider: ProviderName, model: string) => Provider;
  loadModels?: (signal: AbortSignal) => Promise<OpenRouterModel[]>;
  maxSubagents: number;
  persistSessions?: boolean;
}

export async function startInteractive(options: InteractiveOptions): Promise<void> {
  const theme = themes[process.env.MINI_AGENT_THEME ?? "default"] ?? themes.default;
  if (!theme) throw new Error("Default terminal theme is unavailable");
  const sessionStore = options.persistSessions === false ? undefined : new SessionStore();
  const instance = render(
    <App {...options} {...(sessionStore ? { sessionStore } : {})} theme={theme} />,
    { exitOnCtrlC: false },
  );
  await instance.waitUntilExit();
}
