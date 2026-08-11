import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { runAgent, type AgentEvent } from "../../src/agent/run-agent.js";
import type { Provider, ProviderRequest, ProviderResponse } from "../../src/providers/types.js";
import { discoverSkills } from "../../src/skills/discovery.js";
import { createWorkspaceTools } from "../../src/tools/workspace.js";

class PageBuilderProvider implements Provider {
  readonly requests: ProviderRequest[] = [];

  async complete(request: ProviderRequest): Promise<ProviderResponse> {
    this.requests.push(structuredClone(request));
    if (this.requests.length === 1) {
      assert.equal(request.tools.some((tool) => tool.name === "write_file"), true);
      return {
        content: [{
          type: "tool_use",
          id: "write-page",
          name: "write_file",
          input: { path: "public/index.html", content: "<!doctype html><h1>Built by tools</h1>\n" },
        }],
        stopReason: "tool_use",
        usage: { inputTokens: 120, outputTokens: 18 },
      };
    }
    assert.match(JSON.stringify(request.messages), /Wrote .*public\/index\.html/);
    return {
      content: [{ type: "text", text: "Created public/index.html." }],
      stopReason: "end_turn",
      usage: { inputTokens: 180, outputTokens: 22 },
    };
  }
}

test("the agent creates an HTML page through visible workspace tool calls", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "mini-agent-page-"));
  const provider = new PageBuilderProvider();
  const events: AgentEvent[] = [];
  const result = await runAgent({
    prompt: "Create an HTML page",
    catalog: await discoverSkills([]),
    provider,
    workspaceTools: await createWorkspaceTools(root, "workspace-write"),
    onEvent: (event) => { events.push(event); },
  });

  assert.equal(result.text, "Created public/index.html.");
  assert.deepEqual(result.usage, { inputTokens: 300, outputTokens: 40 });
  assert.match(await readFile(path.join(root, "public/index.html"), "utf8"), /Built by tools/);
  assert.equal(events.some((event) => event.type === "workspace_tool_started"), true);
  assert.equal(events.some((event) => event.type === "workspace_tool_completed"), true);
});
