import assert from "node:assert/strict";
import test from "node:test";

import { AnthropicProvider } from "../../src/providers/anthropic-lite.js";

test("the lite provider calls the Claude Messages API without an SDK dependency", async () => {
  let request: RequestInit | undefined;
  const provider = new AnthropicProvider({
    apiKey: "test-key",
    model: "claude-sonnet-5",
    fetch: async (_input, init) => {
      request = init;
      return new Response(
        JSON.stringify({
          id: "msg_test",
          content: [{ type: "text", text: "Hello" }],
          stop_reason: "end_turn",
          usage: { input_tokens: 42, output_tokens: 7 },
        }),
        { status: 200, headers: { "content-type": "application/json", "request-id": "req_test" } },
      );
    },
  });

  const response = await provider.complete({
    system: "Be concise.",
    messages: [{ role: "user", content: [{ type: "text", text: "Hi" }] }],
    tools: [],
  });

  assert.equal(response.content[0]?.type, "text");
  assert.equal(response.requestId, "req_test");
  assert.deepEqual(response.usage, { inputTokens: 42, outputTokens: 7 });
  assert.match(String(request?.body), /claude-sonnet-5/);
  assert.equal((request?.headers as Record<string, string>)["x-api-key"], "test-key");
});
