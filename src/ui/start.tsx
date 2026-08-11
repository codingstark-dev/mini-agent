import React from "react";
import { Box, Text, render, useApp, useStdout } from "ink";

import type { ProviderName } from "../providers/create.js";
import type { OpenRouterModel } from "../providers/openrouter-models.js";
import type { Provider } from "../providers/types.js";
import { SessionStore, type SessionTurn } from "../session/session-store.js";
import type { SkillCatalog } from "../skills/discovery.js";
import type { WorkspaceTools } from "../tools/workspace.js";
import { ActivityView, activityLineCount } from "./activity-view.js";
import { ChoicePicker } from "./choice-picker.js";
import { ModelPicker } from "./model-picker.js";
import { SlashSuggestions } from "./slash-suggestions.js";
import { useHarnessController } from "./use-harness.js";
import { fitRecentTurns } from "./viewport.js";

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

function compactTokens(value: number): string {
  if (value < 1000) return String(value);
  if (value < 1_000_000) return `${(value / 1000).toFixed(value < 10_000 ? 1 : 0)}k`;
  return `${(value / 1_000_000).toFixed(1)}m`;
}

interface AppProperties {
  catalog: SkillCatalog;
  provider: Provider;
  providerName: ProviderName;
  providerLabel: string;
  model: string;
  createProvider?: (provider: ProviderName, model: string) => Provider;
  loadModels?: (signal: AbortSignal) => Promise<OpenRouterModel[]>;
  maxSubagents: number;
  workspaceTools: WorkspaceTools;
  sessionStore?: SessionStore;
  theme: Theme;
}

function TurnView({ turn, showActivity, theme }: {
  turn: SessionTurn;
  showActivity: boolean;
  theme: Theme;
}): React.JSX.Element {
  return (
    <Box flexDirection="column" marginBottom={1}>
      <Text color={theme.prompt}>❯ {turn.prompt}</Text>
      {showActivity && turn.activity.length > 0 && (
        <ActivityView accent={theme.accent} events={turn.activity} maxItems={4} muted={theme.muted} />
      )}
      <Text color={theme.answer}>{turn.answer}</Text>
    </Box>
  );
}

function App(properties: AppProperties): React.JSX.Element {
  const { exit } = useApp();
  const { stdout } = useStdout();
  const harness = useHarnessController({
    catalog: properties.catalog,
    provider: properties.provider,
    providerName: properties.providerName,
    providerLabel: properties.providerLabel,
    model: properties.model,
    maxSubagents: properties.maxSubagents,
    workspaceTools: properties.workspaceTools,
    exit,
    ...(properties.createProvider ? { createProvider: properties.createProvider } : {}),
    ...(properties.loadModels ? { loadModels: properties.loadModels } : {}),
    ...(properties.sessionStore ? { sessionStore: properties.sessionStore } : {}),
  });
  const rows = Math.max(12, stdout.rows ?? 24);
  const columns = Math.max(32, stdout.columns ?? 80);
  const pickerOpen = harness.modelPickerOpen || Boolean(harness.picker);
  const panelRows = harness.panel ? harness.panel.split("\n").length + 2 : 0;
  const suggestionRows = harness.suggestions.length > 0 ? harness.suggestions.length + 3 : 0;
  const reservedRows = 4 + panelRows + suggestionRows +
    (harness.notice ? 1 : 0) +
    (harness.activeSkills.length > 0 ? 1 : 0) +
    (harness.busy ? activityLineCount(harness.liveActivity, 5) : 0);
  const turnWindow = fitRecentTurns(
    harness.turns,
    Math.max(1, rows - reservedRows),
    columns,
    harness.showActivity,
  );

  return (
    <Box flexDirection="column" height={rows} overflow="hidden" paddingX={1}>
      <Box flexShrink={0} gap={1} width="100%">
        <Text bold color={properties.theme.accent}>mini-agent</Text>
        <Box flexGrow={1} overflow="hidden">
          <Text color={properties.theme.muted} wrap="truncate-end">
            {harness.providerLabel} · {harness.model} · session {harness.session.id}
          </Text>
        </Box>
        <Text color={properties.theme.muted}>
          {compactTokens(harness.usage.inputTokens)} in · {compactTokens(harness.usage.outputTokens)} out
        </Text>
      </Box>

      <Box flexDirection="column" flexGrow={1} overflow="hidden">
        {harness.notice && <Text color={properties.theme.accent}>{harness.notice}</Text>}
        {harness.panel && (
          <Box borderStyle="single" borderColor={properties.theme.muted} paddingX={1}>
            <Text color={properties.theme.muted}>{harness.panel}</Text>
          </Box>
        )}
        {harness.activeSkills.length > 0 && (
          <Text color={properties.theme.accent}>active: {harness.activeSkills.join(", ")}</Text>
        )}

        {harness.modelPickerOpen && properties.loadModels ? (
          <ModelPicker
            accent={properties.theme.accent}
            currentModel={harness.model}
            loadModels={properties.loadModels}
            muted={properties.theme.muted}
            onCancel={harness.closePicker}
            onSelect={(selected) => { void harness.switchModel(selected); }}
          />
        ) : harness.picker ? (
          <ChoicePicker
            accent={properties.theme.accent}
            choices={harness.picker.choices}
            emptyMessage={harness.picker.kind === "history" ? "No saved sessions." : "No turns to rewind."}
            muted={properties.theme.muted}
            onCancel={harness.closePicker}
            onSelect={(id) => { void harness.selectChoice(id); }}
            title={harness.picker.kind === "history" ? "Session history" : "Rewind conversation"}
          />
        ) : (
          <>
            <Box flexDirection="column" flexGrow={1} marginTop={1} overflow="hidden">
              {turnWindow.hidden > 0 && (
                <Text color={properties.theme.muted}>
                  ↑ {turnWindow.hidden} earlier turn{turnWindow.hidden === 1 ? "" : "s"} hidden · /history to resume
                </Text>
              )}
              {turnWindow.turns.map((turn) => (
                <TurnView
                  key={turn.id}
                  turn={turn}
                  showActivity={harness.showActivity}
                  theme={properties.theme}
                />
              ))}
            </Box>
            {harness.busy && harness.liveActivity.length > 0 && (
              <ActivityView
                accent={properties.theme.accent}
                events={harness.liveActivity}
                muted={properties.theme.muted}
              />
            )}
            {!harness.busy && harness.suggestions.length > 0 && (
              <SlashSuggestions
                accent={properties.theme.accent}
                muted={properties.theme.muted}
                selectedIndex={harness.suggestionIndex}
                suggestions={harness.suggestions}
              />
            )}
          </>
        )}
      </Box>

      {!pickerOpen && (
        <Box flexDirection="column" flexShrink={0}>
          <Box>
            <Text color={properties.theme.prompt}>❯ </Text>
            <Text>{harness.busy ? "working…" : harness.input}</Text>
            {!harness.busy && <Text inverse> </Text>}
          </Box>
          <Text color={properties.theme.muted} wrap="truncate-end">
            {harness.busy
              ? "Esc stop current run · Ctrl+C exit"
              : `/ commands and skills${harness.canPickModels ? " · Ctrl+P models" : ""} · Ctrl+R rewind · Ctrl+C exit`}
          </Text>
        </Box>
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
  workspaceTools: WorkspaceTools;
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
