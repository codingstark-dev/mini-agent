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
        <Text
          key={`${suggestion.kind}:${suggestion.name}`}
          wrap="truncate-end"
          {...(index === selectedIndex ? { color: accent } : { color: muted })}
        >
          {index === selectedIndex ? "›" : " "} /{suggestion.name} [{suggestion.kind}] {suggestion.description}
        </Text>
      ))}
      <Text color={muted}>↑↓ select · Tab complete · Esc close</Text>
    </Box>
  );
}
