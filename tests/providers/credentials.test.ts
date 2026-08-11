import assert from "node:assert/strict";
import { mkdtemp, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { CredentialStore } from "../../src/providers/credentials.js";

test("API keys configured in the UI are stored with owner-only permissions", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "mini-agent-credentials-"));
  const file = path.join(directory, "credentials.json");
  const store = new CredentialStore(file);

  await store.set("anthropic", "test-anthropic-key");

  assert.equal(await store.get("anthropic"), "test-anthropic-key");
  assert.equal((await stat(file)).mode & 0o777, 0o600);
});

test("credentials remain separate for each provider", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "mini-agent-credentials-"));
  const store = new CredentialStore(path.join(directory, "credentials.json"));

  await store.set("openrouter", "test-openrouter-key");

  assert.equal(await store.get("anthropic"), undefined);
  assert.equal(await store.get("openrouter"), "test-openrouter-key");
});
