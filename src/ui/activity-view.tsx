import React from "react";
import { Box, Text } from "ink";

import type { AgentEvent } from "../agent/run-agent.js";

export interface ActivityItem {
  id: string;
  label: string;
  status: "running" | "complete" | "failed" | "info";
}

function replaceOrAppend(items: ActivityItem[], next: ActivityItem): void {
  const index = items.findIndex((item) => item.id === next.id);
  if (index === -1) items.push(next);
  else items[index] = next;
}

export function activityItems(events: readonly AgentEvent[]): ActivityItem[] {
  const items: ActivityItem[] = [];
  for (const event of events) {
    switch (event.type) {
      case "model_request":
        replaceOrAppend(items, { id: `model:${event.turn}`, label: `model call ${event.turn}`, status: "running" });
        break;
      case "model_response":
        const tokenLabel = event.usage
          ? ` · ${event.usage.inputTokens} in / ${event.usage.outputTokens} out`
          : "";
        replaceOrAppend(items, {
          id: `model:${event.turn}`,
          label: `model call ${event.turn} · ${event.stopReason.replaceAll("_", " ")}${tokenLabel}`,
          status: "complete",
        });
        break;
      case "skill_activated":
        items.push({ id: `skill:${items.length}`, label: `loaded skill ${event.name}`, status: "info" });
        break;
      case "resource_read":
        items.push({ id: `resource:${items.length}`, label: `read ${event.skill}/${event.path}`, status: "complete" });
        break;
      case "subagent_started":
        replaceOrAppend(items, { id: `subagent:${event.id}`, label: `${event.role} subagent`, status: "running" });
        break;
      case "subagent_completed":
        replaceOrAppend(items, { id: `subagent:${event.id}`, label: `${event.role} subagent`, status: "complete" });
        break;
      case "subagent_failed":
        replaceOrAppend(items, { id: `subagent:${event.id}`, label: `${event.role} subagent · ${event.message}`, status: "failed" });
        break;
      case "workflow_role_started":
        replaceOrAppend(items, { id: `workflow:${event.id}`, label: event.role, status: "running" });
        break;
      case "workflow_role_completed":
        replaceOrAppend(items, { id: `workflow:${event.id}`, label: event.role, status: "complete" });
        break;
      case "workflow_verification":
        replaceOrAppend(items, {
          id: `workflow:${event.id}`,
          label: `super-verifier · ${event.detail}`,
          status: event.passed ? "complete" : "failed",
        });
        break;
      case "workspace_tool_started":
        replaceOrAppend(items, { id: `tool:${event.id}`, label: event.detail, status: "running" });
        break;
      case "workspace_tool_completed":
        replaceOrAppend(items, { id: `tool:${event.id}`, label: event.detail, status: "complete" });
        break;
      case "workspace_tool_failed":
        replaceOrAppend(items, { id: `tool:${event.id}`, label: `${event.detail} · ${event.message}`, status: "failed" });
        break;
      case "complete":
        break;
    }
  }
  return items;
}

export function activityLineCount(events: readonly AgentEvent[], maximum: number): number {
  return Math.min(activityItems(events).length, maximum);
}

function marker(status: ActivityItem["status"]): string {
  if (status === "running") return "◌";
  if (status === "complete") return "✓";
  if (status === "failed") return "!";
  return "◆";
}

interface ActivityViewProperties {
  accent: string;
  events: readonly AgentEvent[];
  maxItems?: number;
  muted: string;
}

export function ActivityView({
  accent,
  events,
  maxItems = 5,
  muted,
}: ActivityViewProperties): React.JSX.Element {
  const items = activityItems(events).slice(-maxItems);
  return (
    <Box flexDirection="column">
      {items.map((item) => (
        <Text
          key={item.id}
          wrap="truncate-end"
          {...(item.status === "failed"
            ? { color: "red" }
            : item.status === "running" || item.status === "info"
              ? { color: accent }
              : { color: muted })}
        >
          {marker(item.status)} {item.label}
        </Text>
      ))}
    </Box>
  );
}
