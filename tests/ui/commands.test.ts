import assert from "node:assert/strict";
import test from "node:test";

import { parseSlashCommand, slashSuggestions } from "../../src/ui/commands.js";

test("slash commands preserve an optional argument", () => {
  assert.deepEqual(parseSlashCommand("/model deepseek/deepseek-v4-flash"), {
    name: "model",
    argument: "deepseek/deepseek-v4-flash",
  });
  assert.deepEqual(parseSlashCommand("/history"), { name: "history", argument: "" });
  assert.equal(parseSlashCommand("explain /model"), undefined);
});

test("slash suggestions combine executable commands and installed skills", () => {
  const skills = [
    { name: "welcome-me", description: "Help a newcomer get started." },
    { name: "documentation", description: "Write project documentation." },
  ];

  assert.deepEqual(slashSuggestions("/mo", skills).slice(0, 2), [
    { name: "model", description: "Choose or set the active model", kind: "command" },
    { name: "models", description: "Choose or set the active model", kind: "command" },
  ]);
  assert.deepEqual(slashSuggestions("/wel", skills), [
    { name: "welcome-me", description: "Help a newcomer get started.", kind: "skill" },
  ]);
  assert.deepEqual(slashSuggestions("/model deep", skills), []);
  assert.deepEqual(slashSuggestions("hello", skills), []);
});
