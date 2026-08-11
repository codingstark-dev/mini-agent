import React, { useState } from "react";
import { Box, Text, render, useApp, useInput } from "ink";

import { runAgent } from "../agent/run-agent.js";
import type { Provider } from "../providers/types.js";
import type { SkillCatalog } from "../skills/discovery.js";

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
  prompt: string;
  answer: string;
  activations: string[];
}

interface AppProperties {
  catalog: SkillCatalog;
  provider: Provider;
  model: string;
  theme: Theme;
}

function App({ catalog, provider, model, theme }: AppProperties): React.JSX.Element {
  const { exit } = useApp();
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [turns, setTurns] = useState<Turn[]>([]);

  async function submit(): Promise<void> {
    const prompt = input.trim();
    if (!prompt || busy) return;
    setInput("");
    setBusy(true);
    try {
      const result = await runAgent({ prompt, catalog, provider });
      setTurns((current) => [...current, { prompt, answer: result.text, activations: result.activations }]);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setTurns((current) => [...current, { prompt, answer: `Error: ${message}`, activations: [] }]);
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
        <Text color={theme.muted}>{model}</Text>
        <Text color={theme.muted}>{catalog.skills.length} skills</Text>
      </Box>

      {activeSkills.length > 0 && (
        <Text color={theme.accent}>active: {activeSkills.join(", ")}</Text>
      )}

      <Box flexDirection="column" marginTop={1}>
        {turns.map((turn, index) => (
          <Box key={`${index}-${turn.prompt}`} flexDirection="column" marginBottom={1}>
            <Text color={theme.prompt}>❯ {turn.prompt}</Text>
            {turn.activations.length > 0 && (
              <Text color={theme.muted}>  skill: {turn.activations.join(", ")}</Text>
            )}
            <Text color={theme.answer}>{turn.answer}</Text>
          </Box>
        ))}
      </Box>

      <Box>
        <Text color={theme.prompt}>❯ </Text>
        <Text>{busy ? "thinking…" : input}</Text>
        {!busy && <Text inverse> </Text>}
      </Box>
      <Text color={theme.muted}>Enter to send · Ctrl+C to exit</Text>
    </Box>
  );
}

export interface InteractiveOptions {
  catalog: SkillCatalog;
  provider: Provider;
  model: string;
}

export async function startInteractive(options: InteractiveOptions): Promise<void> {
  const theme = themes[process.env.MINI_AGENT_THEME ?? "default"] ?? themes.default;
  if (!theme) throw new Error("Default terminal theme is unavailable");
  const instance = render(<App {...options} theme={theme} />);
  await instance.waitUntilExit();
}
