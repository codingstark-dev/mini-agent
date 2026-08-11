import assert from "node:assert/strict";
import test from "node:test";

import type { SessionTurn } from "../../src/session/session-store.js";
import { fitRecentTurns } from "../../src/ui/viewport.js";

function turn(id: string, answer = "answer"): SessionTurn {
  return {
    id,
    prompt: `prompt ${id}`,
    answer,
    activations: [],
    activity: [],
    createdAt: "2026-08-11T00:00:00.000Z",
  };
}

test("the viewport keeps the newest turns inside its line budget", () => {
  const result = fitRecentTurns([turn("one"), turn("two"), turn("three")], 6, 80, false);

  assert.deepEqual(result.turns.map((item) => item.id), ["two", "three"]);
  assert.equal(result.hidden, 1);
});

test("the viewport accounts for wrapped answers", () => {
  const result = fitRecentTurns(
    [turn("one"), turn("two", "a".repeat(90))],
    4,
    40,
    false,
  );

  assert.deepEqual(result.turns.map((item) => item.id), ["two"]);
  assert.equal(result.hidden, 1);
});
