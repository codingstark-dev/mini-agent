import React, { useCallback, useRef, useState } from "react";
import { Box, Text, render, useApp, useInput } from "ink";

import { runAgent } from "../agent/run-agent.js";
import type { OpenRouterModel } from "../providers/openrouter-models.js";
import type { Provider } from "../providers/types.js";
import type { SkillCatalog } from "../skills/discovery.js";
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

interface Turn {
  id: number;
  prompt: string;
  answer: string;
  activations: string[];
}

interface AppProperties {
  catalog: SkillCatalog;
  provider: Provider;
  model: string;
  providerLabel: string;
  createProvider?: (model: string) => Provider;
  loadModels?: (signal: AbortSignal) => Promise<OpenRouterModel[]>;
  theme: Theme;
}

function App({
  catalog,
  provider: initialProvider,
  model: initialModel,
  providerLabel,
  createProvider,
  loadModels,
  theme,
}: AppProperties): React.JSX.Element {
  const { exit } = useApp();
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [provider, setProvider] = useState(initialProvider);
  const [model, setModel] = useState(initialModel);
  const [modelPickerOpen, setModelPickerOpen] = useState(false);
  const [notice, setNotice] = useState("");
  const nextTurnId = useRef(0);

  const closeModelPicker = useCallback(() => { setModelPickerOpen(false); }, []);
  const selectModel = useCallback((selectedModel: string) => {
    if (!createProvider) return;
    setProvider(createProvider(selectedModel));
    setModel(selectedModel);
    setNotice(`Switched to ${selectedModel}`);
    setModelPickerOpen(false);
  }, [createProvider]);

  async function submit(): Promise<void> {
    const prompt = input.trim();
    if (!prompt || busy) return;
    setInput("");
    setBusy(true);
    try {
      const result = await runAgent({ prompt, catalog, provider });
      const id = nextTurnId.current++;
      setTurns((current) => [
        ...current,
        { id, prompt, answer: result.text, activations: result.activations },
      ]);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const id = nextTurnId.current++;
      setTurns((current) => [
        ...current,
        { id, prompt, answer: `Error: ${message}`, activations: [] },
      ]);
    } finally {
      setBusy(false);
    }
  }

  useInput((character, key) => {
    if (key.ctrl && character === "c") {
      exit();
      return;
    }
    if (busy) return;
    if (modelPickerOpen) return;
    if (key.ctrl && character === "p" && loadModels && createProvider) {
      setModelPickerOpen(true);
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

  return (
    <Box flexDirection="column" paddingX={1}>
      <Box gap={1}>
        <Text bold color={theme.accent}>mini-agent</Text>
        <Text color={theme.muted}>{providerLabel} · {model}</Text>
        <Text color={theme.muted}>{catalog.skills.length} skills</Text>
      </Box>

      {notice && <Text color={theme.accent}>{notice}</Text>}

      {activeSkills.length > 0 && (
        <Text color={theme.accent}>active: {activeSkills.join(", ")}</Text>
      )}

      <Box flexDirection="column" marginTop={1}>
        {turns.map((turn) => (
          <Box key={turn.id} flexDirection="column" marginBottom={1}>
            <Text color={theme.prompt}>❯ {turn.prompt}</Text>
            {turn.activations.length > 0 && (
              <Text color={theme.muted}>  skill: {turn.activations.join(", ")}</Text>
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
          onCancel={closeModelPicker}
          onSelect={selectModel}
        />
      ) : (
        <>
          <Box>
            <Text color={theme.prompt}>❯ </Text>
            <Text>{busy ? "thinking…" : input}</Text>
            {!busy && <Text inverse> </Text>}
          </Box>
          <Text color={theme.muted}>
            Enter to send{loadModels ? " · Ctrl+P models" : ""} · Ctrl+C to exit
          </Text>
        </>
      )}
    </Box>
  );
}

export interface InteractiveOptions {
  catalog: SkillCatalog;
  provider: Provider;
  model: string;
  providerLabel: string;
  createProvider?: (model: string) => Provider;
  loadModels?: (signal: AbortSignal) => Promise<OpenRouterModel[]>;
}

export async function startInteractive(options: InteractiveOptions): Promise<void> {
  const theme = themes[process.env.MINI_AGENT_THEME ?? "default"] ?? themes.default;
  if (!theme) throw new Error("Default terminal theme is unavailable");
  const instance = render(<App {...options} theme={theme} />, { exitOnCtrlC: false });
  await instance.waitUntilExit();
}
