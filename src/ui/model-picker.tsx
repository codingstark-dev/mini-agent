import React, { useEffect, useMemo, useState } from "react";
import { Box, Text, useInput } from "ink";

import type { OpenRouterModel } from "../providers/openrouter-models.js";

interface ModelPickerProperties {
  accent: string;
  currentModel: string;
  loadModels: (signal: AbortSignal) => Promise<OpenRouterModel[]>;
  muted: string;
  onCancel: () => void;
  onSelect: (model: string) => void;
}

interface PickerItem {
  id: string;
  label: string;
  detail?: string;
}

function modelDetail(model: OpenRouterModel): string {
  const details: string[] = [];
  if (model.contextLength) {
    details.push(`${Math.round(model.contextLength / 1000).toLocaleString()}k ctx`);
  }
  if (model.promptPrice !== undefined && model.completionPrice !== undefined) {
    details.push(`$${model.promptPrice.toFixed(2)}/$${model.completionPrice.toFixed(2)} per M`);
  }
  return details.join(" · ");
}

export function ModelPicker({
  accent,
  currentModel,
  loadModels,
  muted,
  onCancel,
  onSelect,
}: ModelPickerProperties): React.JSX.Element {
  const [models, setModels] = useState<OpenRouterModel[]>([]);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    loadModels(controller.signal).then(
      (available) => {
        setModels(available);
        setLoading(false);
      },
      (reason: unknown) => {
        if (controller.signal.aborted) return;
        setError(reason instanceof Error ? reason.message : String(reason));
        setLoading(false);
      },
    );
    return () => { controller.abort(); };
  }, [loadModels]);

  const items = useMemo(() => {
    const search = query.trim().toLowerCase();
    const matches = models
      .filter((model) => {
        if (!search) return true;
        return model.id.toLowerCase().includes(search) || model.name.toLowerCase().includes(search);
      })
      .sort((left, right) => Number(right.id === search) - Number(left.id === search))
      .slice(0, 8)
      .map<PickerItem>((model) => ({
        id: model.id,
        label: model.name,
        ...(modelDetail(model) ? { detail: modelDetail(model) } : {}),
      }));
    const custom = query.trim();
    if (custom.includes("/") && !models.some((model) => model.id === custom)) {
      matches.push({ id: custom, label: "Use custom model ID" });
    }
    return matches;
  }, [models, query]);

  useEffect(() => {
    setSelected((current) => Math.min(current, Math.max(0, items.length - 1)));
  }, [items.length]);

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
      setSelected((current) => Math.min(items.length - 1, current + 1));
      return;
    }
    if (key.return) {
      const choice = items[selected];
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
      <Text bold color={accent}>Switch model</Text>
      <Text color={muted}>Current: {currentModel}</Text>
      <Text>Search or paste a provider/model ID</Text>
      <Text color={accent}>❯ {query}<Text inverse> </Text></Text>
      {loading && <Text color={muted}>Loading tool-capable models…</Text>}
      {error && <Text color="red">{error}</Text>}
      {!loading && items.length === 0 && (
        <Text color={muted}>No matches. Enter a complete provider/model ID.</Text>
      )}
      {items.map((item, index) => (
        <Text key={item.id} {...(index === selected ? { color: accent } : {})}>
          {index === selected ? "› " : "  "}{item.label}
          {item.label === item.id ? "" : `  ${item.id}`}
          {item.detail ? `  ${item.detail}` : ""}
        </Text>
      ))}
      <Text color={muted}>↑↓ choose · Enter switch · Esc close</Text>
    </Box>
  );
}
