import assert from "node:assert/strict";
import test from "node:test";

import type { AgentEvent } from "../../src/agent/run-agent.js";
import { activityItems } from "../../src/ui/activity-view.js";

test("activity items turn a workspace tool call into one persistent status row", () => {
  const events: AgentEvent[] = [
    { type: "model_request", turn: 1 },
    { type: "model_response", turn: 1, stopReason: "tool_use" },
    { type: "workspace_tool_started", id: "write-1", name: "write_file", detail: "write_file public/index.html" },
    { type: "workspace_tool_completed", id: "write-1", name: "write_file", detail: "wrote public/index.html" },
    { type: "model_request", turn: 2 },
  ];

  assert.deepEqual(activityItems(events), [
    { id: "model:1", label: "model call 1 · tool use", status: "complete" },
    { id: "tool:write-1", label: "wrote public/index.html", status: "complete" },
    { id: "model:2", label: "model call 2", status: "running" },
  ]);
});

test("activity items retain a failed tool result", () => {
  const events: AgentEvent[] = [
    { type: "workspace_tool_started", id: "read-1", name: "read_file", detail: "read_file ../secret" },
    { type: "workspace_tool_failed", id: "read-1", name: "read_file", detail: "read_file ../secret", message: "outside the workspace" },
  ];

  assert.deepEqual(activityItems(events), [
    { id: "tool:read-1", label: "read_file ../secret · outside the workspace", status: "failed" },
  ]);
});
