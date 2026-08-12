import React from "react";
import { Box, Text } from "ink";

import type { AgentEvent } from "../agent/run-agent.js";
import { ActivityView, activityItems, activityLineCount } from "./activity-view.js";
import { InlineLoader, TextLoader } from "./terminal-loaders.js";

interface LiveTurnProperties {
  accent: string;
  answer: string;
  columns: number;
  events: readonly AgentEvent[];
  muted: string;
  prompt: string;
  promptColor: string;
  streamingText: string;
}

function normalizedLine(text: string): string {
  return text.replaceAll(/\s+/g, " ").trim();
}

export function liveResponsePreview(text: string, columns: number): string {
  const line = normalizedLine(text);
  const maximum = Math.max(20, columns - 4) * 4;
  return line.slice(-maximum);
}

export function liveTurnLineCount(
  events: readonly AgentEvent[],
  streamingText: string,
  columns: number,
): number {
  const preview = liveResponsePreview(streamingText, columns);
  const responseLines = preview ? Math.min(4, Math.ceil([...preview].length / Math.max(20, columns - 4))) : 1;
  return 2 + activityLineCount(events, 4) + responseLines;
}

export function LiveTurn({
  accent,
  answer,
  columns,
  events,
  muted,
  prompt,
  promptColor,
  streamingText,
}: LiveTurnProperties): React.JSX.Element {
  const preview = liveResponsePreview(streamingText, columns);
  const currentActivity = activityItems(events).at(-1)?.label ?? "calling the model";
  return (
    <Box flexDirection="column" marginBottom={1}>
      <Text color={promptColor} wrap="truncate-end">❯ {prompt}</Text>
      {events.length > 0 && (
        <ActivityView accent={accent} events={events} maxItems={4} muted={muted} />
      )}
      <Box>
        <InlineLoader color={accent} variant="matrix" size={24} />
        <Text> </Text>
        <TextLoader color={preview ? answer : accent} text={preview || currentActivity} variant="focus" />
      </Box>
    </Box>
  );
}
