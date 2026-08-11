import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import type { Provider, ProviderRequest, ProviderResponse } from "../../src/providers/types.js";
import { discoverSkills } from "../../src/skills/discovery.js";
import { WorkspaceTools } from "../../src/tools/workspace.js";
import {
  planWorkflow,
  runNextWorkflowStep,
  runWorkflowLoop,
} from "../../src/workflow/native-harness.js";
import { nativeRoles } from "../../agents/index.js";

class ScriptedProvider implements Provider {
  readonly requests: ProviderRequest[] = [];

  constructor(private readonly responses: string[]) {}

  async complete(request: ProviderRequest): Promise<ProviderResponse> {
    this.requests.push(structuredClone(request));
    const text = this.responses.shift();
    if (text === undefined) throw new Error("No scripted provider response remains");
    return {
      content: [{ type: "text", text }],
      stopReason: "end_turn",
      usage: { inputTokens: 10, outputTokens: 5 },
    };
  }
}

async function fixture(responses: string[]) {
  const root = await mkdtemp(path.join(tmpdir(), "mini-agent-workflow-"));
  return {
    catalog: await discoverSkills([]),
    provider: new ScriptedProvider(responses),
    workspaceTools: new WorkspaceTools(root, "workspace-write"),
  };
}

test("the native harness exposes five focused roles", () => {
  assert.deepEqual(Object.keys(nativeRoles), [
    "super-planner",
    "super-executor",
    "super-verifier",
    "super-explorer",
    "super-oracle",
  ]);
});

test("plan creates a stored, decision-complete workflow", async () => {
  const options = await fixture([
    JSON.stringify({
      summary: "Add a health endpoint",
      steps: [{
        title: "Implement the route",
        instructions: "Add GET /health to the existing router.",
        verification: "Run the route test and confirm a 200 response.",
      }],
    }),
  ]);

  const result = await planWorkflow({ ...options, task: "Add a health endpoint" });

  assert.equal(result.state.status, "planned");
  assert.equal(result.state.steps[0]?.status, "pending");
  assert.match(result.text, /1\. Implement the route/);
  assert.match(options.provider.requests[0]?.system ?? "", /decision-complete/i);
  assert.equal(options.provider.requests[0]?.tools.some((tool) => tool.name === "write_file"), false);
});

test("start-work executes one step and independently verifies it", async () => {
  const options = await fixture([
    "Implemented the route and added a focused test.",
    "PASS\nThe route test covers the expected 200 response.",
  ]);
  const state = {
    version: 1 as const,
    task: "Add a health endpoint",
    summary: "Add a health endpoint",
    status: "planned" as const,
    createdAt: "2026-08-11T12:00:00.000Z",
    updatedAt: "2026-08-11T12:00:00.000Z",
    steps: [{
      id: "step-1",
      title: "Implement the route",
      instructions: "Add GET /health to the existing router.",
      verification: "Run the route test.",
      status: "pending" as const,
      attempts: 0,
    }],
  };

  const result = await runNextWorkflowStep({ ...options, state });

  assert.equal(result.state.status, "passed");
  assert.equal(result.state.steps[0]?.status, "passed");
  assert.equal(result.state.steps[0]?.attempts, 1);
  assert.match(result.text, /PASS/);
  assert.match(options.provider.requests[0]?.system ?? "", /one assigned step/i);
  assert.match(options.provider.requests[1]?.system ?? "", /independent verifier/i);
});

test("loop continues step by step until the verifier passes the plan", async () => {
  const options = await fixture([
    "Implemented step one.",
    "PASS\nStep one is correct.",
    "Implemented step two.",
    "PASS\nStep two is correct.",
  ]);
  const state = {
    version: 1 as const,
    task: "Ship a small feature",
    summary: "Two small changes",
    status: "planned" as const,
    createdAt: "2026-08-11T12:00:00.000Z",
    updatedAt: "2026-08-11T12:00:00.000Z",
    steps: [
      { id: "step-1", title: "First", instructions: "Do first.", verification: "Check first.", status: "pending" as const, attempts: 0 },
      { id: "step-2", title: "Second", instructions: "Do second.", verification: "Check second.", status: "pending" as const, attempts: 0 },
    ],
  };

  const result = await runWorkflowLoop({ ...options, state, maxIterations: 4 });

  assert.equal(result.state.status, "passed");
  assert.deepEqual(result.state.steps.map((step) => step.status), ["passed", "passed"]);
  assert.equal(options.provider.requests.length, 4);
  assert.equal(result.usage.inputTokens, 40);
  assert.equal(result.usage.outputTokens, 20);
});
