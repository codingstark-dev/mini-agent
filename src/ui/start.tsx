import React from "react";
import { Box, Text, render, useApp } from "ink";

import type { ProviderName } from "../providers/create.js";
import type { OpenRouterModel } from "../providers/openrouter-models.js";
import type { Provider } from "../providers/types.js";
import { SessionStore, type SessionTurn } from "../session/session-store.js";
import type { SkillCatalog } from "../skills/discovery.js";
import { ChoicePicker } from "./choice-picker.js";
import { ModelPicker } from "./model-picker.js";
import { SlashSuggestions } from "./slash-suggestions.js";
import { activityLabel, useHarnessController } from "./use-harness.js";

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

function TurnView({ turn, showActivity, theme }: {
  turn: SessionTurn;
  showActivity: boolean;
  theme: Theme;
}): React.JSX.Element {
  return (
    <Box flexDirection="column" marginBottom={1}>
      <Text color={theme.prompt}>❯ {turn.prompt}</Text>
      {showActivity && turn.activity.length > 0 && (
        <Text color={theme.muted}>  {turn.activity.map(activityLabel).join(" → ")}</Text>
      )}
      <Text color={theme.answer}>{turn.answer}</Text>
    </Box>
  );
}

function App(properties: AppProperties): React.JSX.Element {
  const { exit } = useApp();
  const harness = useHarnessController({
    catalog: properties.catalog,
    provider: properties.provider,
    providerName: properties.providerName,
    providerLabel: properties.providerLabel,
    model: properties.model,
    maxSubagents: properties.maxSubagents,
    exit,
    ...(properties.createProvider ? { createProvider: properties.createProvider } : {}),
    ...(properties.loadModels ? { loadModels: properties.loadModels } : {}),
    ...(properties.sessionStore ? { sessionStore: properties.sessionStore } : {}),
  });

  return (
    <Box flexDirection="column" paddingX={1}>
      <Box gap={1}>
        <Text bold color={properties.theme.accent}>mini-agent</Text>
        <Text color={properties.theme.muted}>{harness.providerLabel} · {harness.model}</Text>
        <Text color={properties.theme.muted}>session {harness.session.id}</Text>
      </Box>

      {harness.notice && <Text color={properties.theme.accent}>{harness.notice}</Text>}
      {harness.panel && (
        <Box borderStyle="single" borderColor={properties.theme.muted} paddingX={1}>
          <Text color={properties.theme.muted}>{harness.panel}</Text>
        </Box>
      )}
      {harness.activeSkills.length > 0 && (
        <Text color={properties.theme.accent}>active: {harness.activeSkills.join(", ")}</Text>
      )}

      <Box flexDirection="column" marginTop={1}>
        {harness.turns.map((turn) => (
          <TurnView
            key={turn.id}
            turn={turn}
            showActivity={harness.showActivity}
            theme={properties.theme}
          />
        ))}
      </Box>

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
          {harness.busy && harness.latestActivity && (
            <Text color={properties.theme.accent}>◌ {activityLabel(harness.latestActivity)}</Text>
          )}
          {!harness.busy && harness.suggestions.length > 0 && (
            <SlashSuggestions
              accent={properties.theme.accent}
              muted={properties.theme.muted}
              selectedIndex={harness.suggestionIndex}
              suggestions={harness.suggestions}
            />
          )}
          <Box>
            <Text color={properties.theme.prompt}>❯ </Text>
            <Text>{harness.busy ? "working…" : harness.input}</Text>
            {!harness.busy && <Text inverse> </Text>}
          </Box>
          <Text color={properties.theme.muted}>
            / commands and skills{harness.canPickModels ? " · Ctrl+P models" : ""} · Ctrl+R rewind · Ctrl+C exit
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
