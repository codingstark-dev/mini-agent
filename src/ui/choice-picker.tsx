import React, { useMemo, useState } from "react";
import { Box, Text, useInput } from "ink";

export interface Choice {
  id: string;
  label: string;
  detail?: string;
}

interface ChoicePickerProperties {
  accent: string;
  choices: Choice[];
  emptyMessage: string;
  muted: string;
  onCancel: () => void;
  onSelect: (id: string) => void;
  title: string;
}

export function ChoicePicker({
  accent,
  choices,
  emptyMessage,
  muted,
  onCancel,
  onSelect,
  title,
}: ChoicePickerProperties): React.JSX.Element {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);
  const visible = useMemo(() => {
    const search = query.trim().toLowerCase();
    return choices
      .filter((choice) => !search || `${choice.label} ${choice.detail ?? ""}`.toLowerCase().includes(search))
      .slice(0, 10);
  }, [choices, query]);

  useInput((character, key) => {
    if (key.escape) {
      onCancel();
      return;
    }
    if (key.upArrow) {
      setSelected((current) => Math.max(0, current - 1));
      return;
    }
    if (key.downArrow) {
      setSelected((current) => Math.min(visible.length - 1, current + 1));
      return;
    }
    if (key.return) {
      const choice = visible[selected];
      if (choice) onSelect(choice.id);
      return;
    }
    if (key.backspace || key.delete) {
      setQuery((current) => [...current].slice(0, -1).join(""));
      setSelected(0);
      return;
    }
    if (!key.ctrl && !key.meta && character) {
      setQuery((current) => current + character);
      setSelected(0);
    }
  });

  return (
    <Box flexDirection="column" borderStyle="round" borderColor={accent} paddingX={1}>
      <Text bold color={accent}>{title}</Text>
      <Text color={accent}>❯ {query}<Text inverse> </Text></Text>
      {visible.length === 0 && <Text color={muted}>{emptyMessage}</Text>}
      {visible.map((choice, index) => (
        <Text key={choice.id} {...(index === selected ? { color: accent } : {})}>
          {index === selected ? "› " : "  "}{choice.label}
          {choice.detail ? `  ${choice.detail}` : ""}
        </Text>
      ))}
      <Text color={muted}>↑↓ choose · Enter select · Esc close</Text>
    </Box>
  );
}
