import assert from "node:assert/strict";
import test from "node:test";

import { parseSlashCommand } from "../../src/ui/commands.js";

test("slash commands preserve an optional argument", () => {
  assert.deepEqual(parseSlashCommand("/model deepseek/deepseek-v4-flash"), {
    name: "model",
    argument: "deepseek/deepseek-v4-flash",
  });
  assert.deepEqual(parseSlashCommand("/history"), { name: "history", argument: "" });
  assert.equal(parseSlashCommand("explain /model"), undefined);
});
