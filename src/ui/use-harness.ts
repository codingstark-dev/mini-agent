import { useReducer, useRef } from "react";
import { useInput } from "ink";

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
  type AgentSession,
  type SessionStore,
  type SessionTurn,
} from "../session/session-store.js";
import type { SkillCatalog } from "../skills/discovery.js";
import type { Choice } from "./choice-picker.js";
import {
  isSlashCommand,
  parseSlashCommand,
  slashHelpText,
  slashSuggestions,
  type SlashCommand,
  type SlashSuggestion,
} from "./commands.js";

export type PickerState =
  | { kind: "history"; choices: Choice[] }
  | { kind: "rewind"; choices: Choice[] };

interface HarnessState {
  input: string;
  busy: boolean;
  provider: Provider;
  providerName: ProviderName;
  providerLabel: string;
  model: string;
  session: AgentSession;
  turns: SessionTurn[];
  liveActivity: AgentEvent[];
  showActivity: boolean;
  modelPickerOpen: boolean;
  picker: PickerState | undefined;
  panel: string;
  notice: string;
  suggestionIndex: number;
}

type HarnessAction =
  | { type: "patch"; value: Partial<HarnessState> }
  | { type: "append_input"; value: string }
  | { type: "backspace" }
  | { type: "move_suggestion"; value: number }
  | { type: "toggle_activity" };

function reduceHarness(state: HarnessState, action: HarnessAction): HarnessState {
  switch (action.type) {
    case "patch":
      return { ...state, ...action.value };
    case "append_input":
      return { ...state, input: state.input + action.value, suggestionIndex: 0 };
    case "backspace":
      return { ...state, input: [...state.input].slice(0, -1).join(""), suggestionIndex: 0 };
    case "move_suggestion":
      return { ...state, suggestionIndex: action.value };
    case "toggle_activity":
      return { ...state, showActivity: !state.showActivity };
  }
}

export interface HarnessOptions {
  catalog: SkillCatalog;
  provider: Provider;
  providerName: ProviderName;
  providerLabel: string;
  model: string;
  createProvider?: (provider: ProviderName, model: string) => Provider;
  loadModels?: (signal: AbortSignal) => Promise<OpenRouterModel[]>;
  maxSubagents: number;
  sessionStore?: SessionStore;
  exit: () => void;
}

export function activityLabel(event: AgentEvent): string {
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

export interface HarnessController extends HarnessState {
  activeSkills: string[];
  canPickModels: boolean;
  closePicker: () => void;
  latestActivity: AgentEvent | undefined;
  suggestions: SlashSuggestion[];
  selectChoice: (id: string) => Promise<void>;
  switchModel: (model: string) => Promise<void>;
}

export function useHarnessController(options: HarnessOptions): HarnessController {
  const runController = useRef<AbortController | undefined>(undefined);
  const [state, dispatch] = useReducer(reduceHarness, undefined, () => ({
    input: "",
    busy: false,
    provider: options.provider,
    providerName: options.providerName,
    providerLabel: options.providerLabel,
    model: options.model,
    session: createSession(options.providerName, options.model),
    turns: [],
    liveActivity: [],
    showActivity: true,
    modelPickerOpen: false,
    picker: undefined,
    panel: "",
    notice: "",
    suggestionIndex: 0,
  }));

  const patch = (value: Partial<HarnessState>): void => {
    dispatch({ type: "patch", value });
  };
  const canPickModels = state.providerName === "openrouter" &&
    Boolean(options.loadModels && options.createProvider);

  const closePicker = (): void => {
    patch({ modelPickerOpen: false, picker: undefined });
  };

  async function saveSession(next: AgentSession): Promise<void> {
    patch({ session: next, turns: next.turns });
    if (options.sessionStore) await options.sessionStore.save(next);
  }

  async function switchModel(selectedModel: string): Promise<void> {
    if (!options.createProvider) return;
    try {
      const nextProvider = options.createProvider(state.providerName, selectedModel);
      const nextSession = {
        ...state.session,
        model: selectedModel,
        updatedAt: new Date().toISOString(),
      };
      patch({ provider: nextProvider, model: selectedModel });
      await saveSession(nextSession);
      patch({ notice: `Switched to ${selectedModel}`, panel: "" });
      closePicker();
    } catch (error) {
      patch({ panel: error instanceof Error ? error.message : String(error) });
    }
  }

  async function resumeSession(id: string): Promise<void> {
    if (!options.sessionStore || !options.createProvider) {
      patch({ panel: "Session history is unavailable in this build." });
      return;
    }
    try {
      const saved = await options.sessionStore.load(id);
      const nextProvider = options.createProvider(saved.provider, saved.model);
      patch({
        provider: nextProvider,
        providerName: saved.provider,
        providerLabel: getProviderLabel(saved.provider),
        model: saved.model,
        session: saved,
        turns: saved.turns,
        notice: `Resumed ${saved.id}`,
        panel: "",
      });
      closePicker();
    } catch (error) {
      patch({ panel: error instanceof Error ? error.message : String(error) });
    }
  }

  async function openHistory(): Promise<void> {
    if (!options.sessionStore) {
      patch({ panel: "Session history is unavailable in this build." });
      return;
    }
    try {
      const summaries = await options.sessionStore.list();
      patch({
        picker: {
          kind: "history",
          choices: summaries.map((summary) => ({
            id: summary.id,
            label: summary.title,
            detail: `${summary.id} · ${summary.provider}/${summary.model} · ${summary.turnCount} turns`,
          })),
        },
        panel: "",
      });
    } catch (error) {
      patch({ panel: error instanceof Error ? error.message : String(error) });
    }
  }

  function rewindChoices(): Choice[] {
    if (state.turns.length === 0) return [];
    return [
      { id: "0", label: "Start of session", detail: "remove every conversation turn" },
      ...state.turns.slice(0, -1).map((turn, index) => ({
        id: String(index + 1),
        label: `After turn ${index + 1}`,
        detail: turn.prompt.replaceAll(/\s+/g, " ").slice(0, 60),
      })),
    ].reverse();
  }

  async function applyRewind(keepTurns: number): Promise<void> {
    try {
      const removed = state.turns.slice(keepTurns);
      const next = rewindSession(state.session, keepTurns);
      await saveSession(next);
      patch({
        input: removed[0]?.prompt ?? "",
        notice: `Rewound ${removed.length} conversation turn${removed.length === 1 ? "" : "s"}`,
        panel: "Conversation context was rewound. No files were changed.",
      });
      closePicker();
    } catch (error) {
      patch({ panel: error instanceof Error ? error.message : String(error) });
    }
  }

  function newSession(): void {
    const next = createSession(state.providerName, state.model);
    patch({
      session: next,
      turns: [],
      input: "",
      panel: "",
      notice: `New session ${next.id}`,
    });
  }

  async function runCommand(command: SlashCommand): Promise<void> {
    switch (command.name) {
      case "help":
        patch({ panel: slashHelpText() });
        return;
      case "model":
      case "models":
        if (command.argument) await switchModel(command.argument);
        else if (canPickModels) patch({ modelPickerOpen: true });
        else patch({ panel: "The searchable model picker is available with OpenRouter. Use /model <id> to switch directly." });
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
      case "rewind": {
        if (!command.argument) {
          patch({ picker: { kind: "rewind", choices: rewindChoices() } });
          return;
        }
        const removeCount = Number(command.argument);
        if (!Number.isInteger(removeCount) || removeCount < 1 || removeCount > state.turns.length) {
          patch({ panel: `Choose a number from 1 to ${state.turns.length}.` });
          return;
        }
        await applyRewind(state.turns.length - removeCount);
        return;
      }
      case "undo":
        if (state.turns.length === 0) patch({ panel: "There is no turn to undo." });
        else await applyRewind(state.turns.length - 1);
        return;
      case "redo":
        try {
          const next = redoSession(state.session);
          await saveSession(next);
          patch({
            input: "",
            notice: `Restored ${next.turns.length - state.turns.length} conversation turn${next.turns.length - state.turns.length === 1 ? "" : "s"}`,
            panel: "",
          });
        } catch (error) {
          patch({ panel: error instanceof Error ? error.message : String(error) });
        }
        return;
      case "clear":
        await applyRewind(0);
        patch({ input: "" });
        return;
      case "new":
        newSession();
        return;
      case "skills":
        patch({ panel: options.catalog.skills.map((skill) => skill.name).join(" · ") || "No skills found." });
        return;
      case "status":
        patch({ panel: `session ${state.session.id}\n${state.providerLabel} · ${state.model}\n${state.turns.length} turns · ${options.catalog.skills.length} skills` });
        return;
      case "activity":
      case "thinking":
        dispatch({ type: "toggle_activity" });
        patch({ panel: "Activity shows provider and tool events, not hidden model thoughts." });
        return;
      case "exit":
      case "quit":
        options.exit();
        return;
    }
  }

  async function submit(): Promise<void> {
    const prompt = state.input.trim();
    if (!prompt || state.busy) return;
    const command = parseSlashCommand(prompt);
    if (command && isSlashCommand(command.name)) {
      patch({ input: "" });
      await runCommand(command);
      return;
    }
    if (command && !options.catalog.skills.some((skill) => skill.name === command.name)) {
      patch({ input: "", panel: `Unknown command: /${command.name}. Type /help for available commands.` });
      return;
    }

    patch({ input: "", busy: true, panel: "", notice: "", liveActivity: [] });
    const controller = new AbortController();
    runController.current = controller;
    const activity: AgentEvent[] = [];
    try {
      const result = await runAgent({
        prompt,
        history: sessionHistory(state.turns),
        catalog: options.catalog,
        provider: state.provider,
        maxSubagents: options.maxSubagents,
        signal: controller.signal,
        onEvent: (event) => {
          activity.push(event);
          patch({ liveActivity: [...activity] });
        },
      });
      const timestamp = new Date().toISOString();
      const turn: SessionTurn = {
        id: `${state.session.id}-${state.turns.length + 1}`,
        prompt,
        answer: result.text,
        activations: result.activations,
        activity,
        createdAt: timestamp,
      };
      const { redoTurns: _discardedRedo, ...committedSession } = state.session;
      await saveSession({
        ...committedSession,
        provider: state.providerName,
        model: state.model,
        updatedAt: timestamp,
        turns: [...state.turns, turn],
      });
    } catch (error) {
      patch({
        panel: controller.signal.aborted
          ? "Run stopped. The conversation was not changed."
          : `Run failed: ${error instanceof Error ? error.message : String(error)}`,
      });
    } finally {
      if (runController.current === controller) runController.current = undefined;
      patch({ busy: false, liveActivity: [] });
    }
  }

  async function selectChoice(id: string): Promise<void> {
    if (state.picker?.kind === "history") await resumeSession(id);
    if (state.picker?.kind === "rewind") await applyRewind(Number(id));
  }

  const suggestions = slashSuggestions(state.input, options.catalog.skills);

  function moveSuggestion(offset: number): void {
    if (suggestions.length === 0) return;
    const next = (state.suggestionIndex + offset + suggestions.length) % suggestions.length;
    dispatch({ type: "move_suggestion", value: next });
  }

  function completeSuggestion(): void {
    const suggestion = suggestions[state.suggestionIndex];
    if (!suggestion) return;
    patch({ input: `/${suggestion.name} `, suggestionIndex: 0 });
  }

  useInput((character, key) => {
    if (key.ctrl && character === "c") {
      runController.current?.abort();
      options.exit();
      return;
    }
    if (state.busy && key.escape) {
      runController.current?.abort();
      patch({ notice: "Stopping current run…" });
      return;
    }
    if (state.busy || state.modelPickerOpen || state.picker) return;
    if (key.ctrl && character === "p" && canPickModels) {
      patch({ modelPickerOpen: true });
      return;
    }
    if (key.ctrl && character === "r") {
      patch({ picker: { kind: "rewind", choices: rewindChoices() } });
      return;
    }
    if (suggestions.length > 0 && key.upArrow) {
      moveSuggestion(-1);
      return;
    }
    if (suggestions.length > 0 && key.downArrow) {
      moveSuggestion(1);
      return;
    }
    if (suggestions.length > 0 && key.tab) {
      completeSuggestion();
      return;
    }
    if (suggestions.length > 0 && key.escape) {
      patch({ input: "", suggestionIndex: 0 });
      return;
    }
    if (key.return) {
      const selected = suggestions[state.suggestionIndex];
      if (selected && state.input !== `/${selected.name}`) {
        completeSuggestion();
        return;
      }
      void submit();
      return;
    }
    if (key.backspace || key.delete) {
      dispatch({ type: "backspace" });
      return;
    }
    if (!key.ctrl && !key.meta && character) {
      dispatch({ type: "append_input", value: character });
    }
  });

  return {
    ...state,
    activeSkills: [...new Set(state.turns.flatMap((turn) => turn.activations))],
    canPickModels,
    closePicker,
    latestActivity: state.liveActivity.at(-1),
    suggestions,
    selectChoice,
    switchModel,
  };
}
