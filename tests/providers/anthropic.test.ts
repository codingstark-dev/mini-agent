import assert from "node:assert/strict";
import test from "node:test";

import { AnthropicProvider } from "../../src/providers/anthropic.js";

test("the Anthropic provider calls the Claude Messages API directly", async () => {
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

test("the Anthropic provider streams text deltas and usage", async () => {
  let request: RequestInit | undefined;
  const deltas: string[] = [];
  const body = [
    'data: {"type":"message_start","message":{"usage":{"input_tokens":11}}}',
    'data: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}',
    'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hello"}}',
    'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":" world"}}',
    'data: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":2}}',
    'data: {"type":"message_stop"}',
    "",
  ].join("\n\n");
  const provider = new AnthropicProvider({
    apiKey: "test-key",
    fetch: async (_input, init) => {
      request = init;
      return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
    },
  });

  const response = await provider.complete({
    system: "Be concise.",
    messages: [{ role: "user", content: [{ type: "text", text: "Hi" }] }],
    tools: [],
    onTextDelta: (text) => { deltas.push(text); },
  });

  assert.equal((JSON.parse(String(request?.body)) as { stream?: boolean }).stream, true);
  assert.deepEqual(deltas, ["Hello", " world"]);
  assert.deepEqual(response.content, [{ type: "text", text: "Hello world" }]);
  assert.equal(response.stopReason, "end_turn");
  assert.deepEqual(response.usage, { inputTokens: 11, outputTokens: 2 });
});

test("the Anthropic stream assembles tool calls", async () => {
  const body = [
    'data: {"type":"message_start","message":{"usage":{"input_tokens":9}}}',
    'data: {"type":"content_block_start","index":0,"content_block":{"type":"tool_use","id":"call_1","name":"activate_skill","input":{}}}',
    'data: {"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"{\\"name\\":"}}',
    'data: {"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"\\"welcome-me\\"}"}}',
    'data: {"type":"message_delta","delta":{"stop_reason":"tool_use"},"usage":{"output_tokens":4}}',
    'data: {"type":"message_stop"}',
    "",
  ].join("\n\n");
  const provider = new AnthropicProvider({
    apiKey: "test-key",
    fetch: async () => new Response(body, { status: 200 }),
  });

  const response = await provider.complete({
    system: "Use tools.",
    messages: [{ role: "user", content: [{ type: "text", text: "Help me start" }] }],
    tools: [],
    onTextDelta() {},
  });

  assert.deepEqual(response.content, [{
    type: "tool_use",
    id: "call_1",
    name: "activate_skill",
    input: { name: "welcome-me" },
  }]);
  assert.equal(response.stopReason, "tool_use");
});
