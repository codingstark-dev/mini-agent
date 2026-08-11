import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { createSession, SessionStore } from "../../src/session/session-store.js";
import { resolveStartupSelection } from "../../src/session/startup-selection.js";

test("interactive startup restores the most recently selected provider and model", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "mini-agent-startup-"));
  const sessions = new SessionStore(directory);
  const saved = createSession(
    "openrouter",
    "deepseek/deepseek-v4-flash-0731",
    new Date("2026-08-12T01:00:00.000Z"),
  );
  await sessions.save(saved);

  const selection = await resolveStartupSelection(
    { provider: "anthropic", model: "claude-sonnet-5" },
    sessions,
    true,
  );

  assert.deepEqual(selection, {
    provider: "openrouter",
    model: "deepseek/deepseek-v4-flash-0731",
  });
});

test("an explicit CLI selection wins over saved sessions", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "mini-agent-startup-"));
  const sessions = new SessionStore(directory);
  await sessions.save(createSession("openrouter", "deepseek/deepseek-v4-flash-0731"));

  const selection = await resolveStartupSelection(
    { provider: "vercel", model: "anthropic/claude-sonnet-4.6" },
    sessions,
    false,
  );

  assert.deepEqual(selection, {
    provider: "vercel",
    model: "anthropic/claude-sonnet-4.6",
  });
});
