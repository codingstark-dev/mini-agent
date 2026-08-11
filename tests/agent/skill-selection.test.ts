import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { runAgent, type AgentEvent } from "../../src/agent/run-agent.js";
import type { Provider, ProviderRequest, ProviderResponse } from "../../src/providers/types.js";
import { discoverSkills } from "../../src/skills/discovery.js";

class WelcomeProvider implements Provider {
  readonly requests: ProviderRequest[] = [];

  async complete(request: ProviderRequest): Promise<ProviderResponse> {
    this.requests.push(structuredClone(request));
    if (this.requests.length === 1) {
      return {
        content: [
          { type: "text", text: "I'll load the welcome instructions." },
          { type: "tool_use", id: "tool-1", name: "activate_skill", input: { name: "welcome-me" } },
        ],
        stopReason: "tool_use",
      };
    }

    return {
      content: [{ type: "text", text: "> Welcome to our agent!\nLet’s get you oriented." }],
      stopReason: "end_turn",
    };
  }
}

class WeatherProvider implements Provider {
  readonly requests: ProviderRequest[] = [];

  async complete(request: ProviderRequest): Promise<ProviderResponse> {
    this.requests.push(structuredClone(request));
    return {
      content: [{ type: "text", text: "I need a location before I can discuss the weather." }],
      stopReason: "end_turn",
    };
  }
}

class ResourceProvider implements Provider {
  readonly requests: ProviderRequest[] = [];

  async complete(request: ProviderRequest): Promise<ProviderResponse> {
    this.requests.push(structuredClone(request));
    if (this.requests.length === 1) {
      return {
        content: [{ type: "tool_use", id: "activate", name: "activate_skill", input: { name: "internal-comms" } }],
        stopReason: "tool_use",
      };
    }
    if (this.requests.length === 2) {
      assert.equal(request.tools.some((tool) => tool.name === "read_skill_resource"), true);
      return {
        content: [{
          type: "tool_use",
          id: "read",
          name: "read_skill_resource",
          input: { skill: "internal-comms", path: "examples/status.md" },
        }],
        stopReason: "tool_use",
      };
    }
    return { content: [{ type: "text", text: "Update ready." }], stopReason: "end_turn" };
  }
}

class TruncatedProvider implements Provider {
  async complete(): Promise<ProviderResponse> {
    return { content: [{ type: "text", text: "Partial answer" }], stopReason: "max_tokens" };
  }
}

class HistoryProvider implements Provider {
  request?: ProviderRequest;

  async complete(request: ProviderRequest): Promise<ProviderResponse> {
    this.request = structuredClone(request);
    return { content: [{ type: "text", text: "Second answer" }], stopReason: "end_turn" };
  }
}

class DelegatingProvider implements Provider {
  readonly requests: ProviderRequest[] = [];

  async complete(request: ProviderRequest): Promise<ProviderResponse> {
    this.requests.push(structuredClone(request));
    if (this.requests.length === 1) {
      return {
        content: [
          {
            type: "tool_use",
            id: "delegate-one",
            name: "delegate_task",
            input: { role: "reviewer", task: "Check the provider boundary." },
          },
        ],
        stopReason: "tool_use",
      };
    }
    if (this.requests.length === 2) {
      return {
        content: [{ type: "text", text: "The provider boundary is narrow and typed." }],
        stopReason: "end_turn",
      };
    }
    return {
      content: [{ type: "text", text: "Review complete." }],
      stopReason: "end_turn",
    };
  }
}

test("the main agent can delegate an isolated task to a bounded subagent", async () => {
  const catalog = await discoverSkills([]);
  const provider = new DelegatingProvider();
  const events: AgentEvent[] = [];

  const result = await runAgent({
    prompt: "Review the architecture",
    catalog,
    provider,
    maxSubagents: 1,
    onEvent: (event) => { events.push(event); },
  });

  assert.equal(result.text, "Review complete.");
  assert.deepEqual(provider.requests[1]?.tools, []);
  assert.match(JSON.stringify(provider.requests[1]?.messages), /Check the provider boundary/);
  assert.match(JSON.stringify(provider.requests[2]?.messages), /provider boundary is narrow and typed/);
  assert.equal(events.some((event) => event.type === "subagent_started"), true);
  assert.equal(events.some((event) => event.type === "subagent_completed"), true);
});

test("previous session turns are included in the next model request", async () => {
  const catalog = await discoverSkills([]);
  const provider = new HistoryProvider();

  await runAgent({
    prompt: "What should we do next?",
    history: [{ prompt: "Summarize the task", answer: "We need to build a small CLI." }],
    catalog,
    provider,
  });

  assert.deepEqual(provider.request?.messages, [
    { role: "user", content: [{ type: "text", text: "Summarize the task" }] },
    { role: "assistant", content: [{ type: "text", text: "We need to build a small CLI." }] },
    { role: "user", content: [{ type: "text", text: "What should we do next?" }] },
  ]);
});

test("the model can select a skill without seeing its instructions up front", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "mini-agent-loop-"));
  const skillDirectory = path.join(root, "welcome-me");
  await mkdir(skillDirectory);
  await writeFile(
    path.join(skillDirectory, "SKILL.md"),
    `---\nname: welcome-me\ndescription: Welcome users who say they are new to a project.\n---\n\nThe answer must start with HARD-TO-GUESS-WELCOME.`,
  );
  const catalog = await discoverSkills([{ directory: root, source: "project" }]);
  const provider = new WelcomeProvider();
  const events: AgentEvent[] = [];

  const result = await runAgent({
    prompt: "I'm new to this project. What should I do?",
    catalog,
    provider,
    onEvent: (event) => { events.push(event); },
  });

  assert.equal(result.activations[0], "welcome-me");
  assert.match(result.text, /^> Welcome to our agent!/);
  assert.match(provider.requests[0]?.system ?? "", /Welcome users who say they are new/);
  assert.equal(provider.requests[0]?.system.includes("HARD-TO-GUESS-WELCOME"), false);
  assert.equal(JSON.stringify(provider.requests[1]?.messages).includes("HARD-TO-GUESS-WELCOME"), true);
  assert.equal(JSON.stringify(provider.requests[1]).includes(root), false);
  assert.deepEqual(events.map((event) => event.type), [
    "model_request",
    "model_response",
    "skill_activated",
    "model_request",
    "model_response",
    "complete",
  ]);
});

test("an unrelated prompt does not load the welcome skill", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "mini-agent-negative-"));
  const skillDirectory = path.join(root, "welcome-me");
  await mkdir(skillDirectory);
  await writeFile(
    path.join(skillDirectory, "SKILL.md"),
    `---\nname: welcome-me\ndescription: Welcome users who say they are new to a project.\n---\n\nPRIVATE WELCOME INSTRUCTIONS`,
  );
  const catalog = await discoverSkills([{ directory: root, source: "project" }]);
  const provider = new WeatherProvider();

  const result = await runAgent({ prompt: "What's the weather?", catalog, provider });

  assert.deepEqual(result.activations, []);
  assert.equal(provider.requests.length, 1);
  assert.equal(JSON.stringify(provider.requests).includes("PRIVATE WELCOME INSTRUCTIONS"), false);
});

test("an activated skill can load one referenced resource", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "mini-agent-resource-loop-"));
  const skillDirectory = path.join(root, "internal-comms");
  await mkdir(path.join(skillDirectory, "examples"), { recursive: true });
  await writeFile(
    path.join(skillDirectory, "SKILL.md"),
    `---\nname: internal-comms\ndescription: Write internal company updates.\n---\n\nRead examples/status.md.`,
  );
  await writeFile(path.join(skillDirectory, "examples", "status.md"), "RESOURCE CONTENT");
  const catalog = await discoverSkills([{ directory: root, source: "project" }]);
  const provider = new ResourceProvider();
  const events: AgentEvent[] = [];

  const result = await runAgent({
    prompt: "Write a status report",
    catalog,
    provider,
    onEvent: (event) => { events.push(event); },
  });

  assert.equal(result.text, "Update ready.");
  assert.equal(JSON.stringify(provider.requests[0]).includes("RESOURCE CONTENT"), false);
  assert.equal(JSON.stringify(provider.requests[2]?.messages).includes("RESOURCE CONTENT"), true);
  assert.equal(events.some((event) => event.type === "resource_read"), true);
});

test("a slash command activates a known skill before the first model turn", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "mini-agent-explicit-"));
  const skillDirectory = path.join(root, "welcome-me");
  await mkdir(skillDirectory);
  await writeFile(
    path.join(skillDirectory, "SKILL.md"),
    `---\nname: welcome-me\ndescription: Welcome new users.\n---\n\nEXPLICIT WELCOME INSTRUCTIONS`,
  );
  const catalog = await discoverSkills([{ directory: root, source: "project" }]);
  const provider = new WeatherProvider();

  const result = await runAgent({ prompt: "/welcome-me show me around", catalog, provider });

  assert.deepEqual(result.activations, ["welcome-me"]);
  assert.equal(JSON.stringify(provider.requests[0]?.messages).includes("EXPLICIT WELCOME INSTRUCTIONS"), true);
  const firstBlock = provider.requests[0]?.messages[0]?.content[0];
  assert.equal(firstBlock?.type === "text" ? firstBlock.text : undefined, "show me around");
});

test("a truncated model response is not reported as a completed answer", async () => {
  await assert.rejects(
    runAgent({
      prompt: "Write a long answer",
      catalog: { skills: [], diagnostics: [] },
      provider: new TruncatedProvider(),
    }),
    /maximum output length/,
  );
});
