import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToString } from "ink";

import type { AgentEvent } from "../../src/agent/run-agent.js";
import { LiveTurn, liveResponsePreview, liveTurnLineCount } from "../../src/ui/live-turn.js";

const events: AgentEvent[] = [
  { type: "model_request", turn: 1 },
];

test("an in-flight response renders as a conversation turn", () => {
  const output = renderToString(React.createElement(LiveTurn, {
    accent: "cyan",
    answer: "white",
    columns: 80,
    events,
    muted: "gray",
    prompt: "Build a snake game",
    promptColor: "green",
    streamingText: "I will create the HTML game now.",
  }));

  assert.match(output, /❯ Build a snake game/);
  assert.match(output, /model call 1/);
  assert.match(output, /I will create the HTML game now\./);
  assert.ok(output.indexOf("Build a snake game") < output.indexOf("I will create"));
});

test("the live response stays within four terminal lines", () => {
  const response = "stream ".repeat(100);
  const preview = liveResponsePreview(response, 40);

  assert.ok([...preview].length <= 144);
  assert.equal(liveTurnLineCount(events, response, 40), 7);
});
