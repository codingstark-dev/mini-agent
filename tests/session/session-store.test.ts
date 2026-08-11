import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  redoSession,
  rewindSession,
  SessionStore,
  type AgentSession,
} from "../../src/session/session-store.js";

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

test("rewind returns the chosen conversation point without mutating history", () => {
  const session: AgentSession = {
    version: 1,
    id: "session-one",
    createdAt: "2026-08-11T10:00:00.000Z",
    updatedAt: "2026-08-11T10:02:00.000Z",
    provider: "openrouter",
    model: "deepseek/deepseek-v4-flash",
    turns: [
      {
        id: "turn-one",
        prompt: "First prompt",
        answer: "First answer",
        activations: [],
        activity: [],
        createdAt: "2026-08-11T10:01:00.000Z",
      },
      {
        id: "turn-two",
        prompt: "Second prompt",
        answer: "Second answer",
        activations: [],
        activity: [],
        createdAt: "2026-08-11T10:02:00.000Z",
      },
    ],
  };

  const rewound = rewindSession(session, 1, new Date("2026-08-11T10:03:00.000Z"));

  assert.deepEqual(rewound.turns.map((turn) => turn.id), ["turn-one"]);
  assert.deepEqual(rewound.redoTurns?.map((turn) => turn.id), ["turn-two"]);
  assert.equal(rewound.updatedAt, "2026-08-11T10:03:00.000Z");
  assert.equal(session.turns.length, 2);

  const restored = redoSession(rewound, new Date("2026-08-11T10:04:00.000Z"));
  assert.deepEqual(restored.turns.map((turn) => turn.id), ["turn-one", "turn-two"]);
  assert.equal(restored.redoTurns, undefined);
});
