import React from "react";
import { Box, Text } from "ink";

import type { SlashSuggestion } from "./commands.js";

interface SlashSuggestionsProperties {
  accent: string;
  muted: string;
  selectedIndex: number;
  suggestions: readonly SlashSuggestion[];
}

export function SlashSuggestions({
  accent,
  muted,
  selectedIndex,
  suggestions,
}: SlashSuggestionsProperties): React.JSX.Element {
  return (
    <Box borderColor={muted} borderStyle="single" flexDirection="column" flexShrink={0} paddingX={1}>
      {suggestions.map((suggestion, index) => (
        <Box gap={1} key={`${suggestion.kind}:${suggestion.name}`} width="100%">
          <Text {...(index === selectedIndex ? { color: accent } : {})}>
            {index === selectedIndex ? "›" : " "} /{suggestion.name}
          </Text>
          <Text color={muted} wrap="truncate-end">[{suggestion.kind}] {suggestion.description}</Text>
        </Box>
      ))}
      <Text color={muted}>↑↓ select · Tab complete · Esc close</Text>
    </Box>
  );
}
