import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { runAgent } from "../../src/agent/run-agent.js";
import type { Provider, ProviderRequest, ProviderResponse } from "../../src/providers/types.js";
import { discoverSkills } from "../../src/skills/discovery.js";

class WelcomeProvider implements Provider {
  readonly requests: ProviderRequest[] = [];

  async complete(request: ProviderRequest): Promise<ProviderResponse> {
    this.requests.push(structuredClone(request));
    if (this.requests.length === 1) {
      return {
        content: [{ type: "tool_use", id: "tool-1", name: "activate_skill", input: { name: "welcome-me" } }],
        stopReason: "tool_use",
      };
    }

    return {
      content: [{ type: "text", text: "> Welcome to our Command Code assignment agent!\nLet’s get you oriented." }],
      stopReason: "end_turn",
    };
  }
}

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

  const result = await runAgent({
    prompt: "I'm new to this project. What should I do?",
    catalog,
    provider,
  });

  assert.equal(result.activations[0], "welcome-me");
  assert.match(result.text, /^> Welcome to our Command Code assignment agent!/);
  assert.match(provider.requests[0]?.system ?? "", /Welcome users who say they are new/);
  assert.equal(provider.requests[0]?.system.includes("HARD-TO-GUESS-WELCOME"), false);
  assert.equal(JSON.stringify(provider.requests[1]?.messages).includes("HARD-TO-GUESS-WELCOME"), true);
});
