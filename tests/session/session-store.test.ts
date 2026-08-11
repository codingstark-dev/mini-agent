import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { SessionStore, type AgentSession } from "../../src/session/session-store.js";

test("a saved session can be listed and resumed", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "mini-agent-sessions-"));
  const store = new SessionStore(directory);
  const session: AgentSession = {
    version: 1,
    id: "session-one",
    createdAt: "2026-08-11T10:00:00.000Z",
    updatedAt: "2026-08-11T10:01:00.000Z",
    provider: "openrouter",
    model: "deepseek/deepseek-v4-flash",
    turns: [
      {
        id: "turn-one",
        prompt: "Review this project",
        answer: "Start with the agent loop.",
        activations: ["welcome-me"],
        activity: [{ type: "skill_activated", name: "welcome-me" }],
        createdAt: "2026-08-11T10:01:00.000Z",
      },
    ],
  };

  await store.save(session);

  assert.deepEqual(await store.load("session-one"), session);
  assert.deepEqual(await store.list(), [
    {
      id: "session-one",
      title: "Review this project",
      updatedAt: "2026-08-11T10:01:00.000Z",
      provider: "openrouter",
      model: "deepseek/deepseek-v4-flash",
      turnCount: 1,
    },
  ]);
});
