import assert from "node:assert/strict";
import test from "node:test";

import { OpenAICompatibleProvider } from "../../src/providers/openai-compatible.js";

test("maps tools and tool calls through an OpenAI-compatible endpoint", async () => {
  let request: RequestInit | undefined;
  const provider = new OpenAICompatibleProvider({
    apiKey: "test-key",
    endpoint: "https://gateway.example/v1/chat/completions",
    model: "anthropic/claude-sonnet",
    name: "Test gateway",
    fetch: async (_input, init) => {
      request = init;
      return new Response(
        JSON.stringify({
          id: "chat_test",
          usage: { prompt_tokens: 90, completion_tokens: 12 },
          choices: [
            {
              finish_reason: "tool_calls",
              message: {
                content: null,
                tool_calls: [
                  {
                    id: "call_1",
                    type: "function",
                    function: { name: "activate_skill", arguments: '{"name":"welcome-me"}' },
                  },
                ],
              },
            },
          ],
        }),
        { status: 200, headers: { "x-request-id": "req_test" } },
      );
    },
  });

  const response = await provider.complete({
    system: "Choose a skill when relevant.",
    messages: [{ role: "user", content: [{ type: "text", text: "I am new here" }] }],
    tools: [
      {
        name: "activate_skill",
        description: "Load a skill",
        inputSchema: {
          type: "object",
          properties: { name: { type: "string" } },
          required: ["name"],
        },
      },
    ],
  });

  const body = JSON.parse(String(request?.body)) as Record<string, unknown>;
  assert.equal(body.model, "anthropic/claude-sonnet");
  assert.deepEqual((body.messages as Array<Record<string, unknown>>)[0], {
    role: "system",
    content: "Choose a skill when relevant.",
  });
  assert.equal((request?.headers as Record<string, string>).authorization, "Bearer test-key");
  assert.deepEqual(response, {
    content: [
      { type: "tool_use", id: "call_1", name: "activate_skill", input: { name: "welcome-me" } },
    ],
    stopReason: "tool_use",
    requestId: "req_test",
    usage: { inputTokens: 90, outputTokens: 12 },
  });
});

test("sends tool results back as tool messages", async () => {
  let body: Record<string, unknown> | undefined;
  const provider = new OpenAICompatibleProvider({
    apiKey: "test-key",
    endpoint: "https://gateway.example/v1/chat/completions",
    model: "anthropic/claude-sonnet",
    name: "Test gateway",
    fetch: async (_input, init) => {
      body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return new Response(
        JSON.stringify({
          choices: [{ finish_reason: "stop", message: { content: "Welcome aboard." } }],
        }),
        { status: 200 },
      );
    },
  });

  const response = await provider.complete({
    system: "Use the loaded skill.",
    messages: [
      { role: "user", content: [{ type: "text", text: "I am new here" }] },
      {
        role: "assistant",
        content: [
          {
            type: "tool_use",
            id: "call_1",
            name: "activate_skill",
            input: { name: "welcome-me" },
          },
        ],
      },
      {
        role: "user",
        content: [{ type: "tool_result", toolUseId: "call_1", content: "Skill instructions" }],
      },
    ],
    tools: [],
  });

  assert.deepEqual((body?.messages as Array<Record<string, unknown>>).slice(-2), [
    {
      role: "assistant",
      content: null,
      tool_calls: [
        {
          id: "call_1",
          type: "function",
          function: { name: "activate_skill", arguments: '{"name":"welcome-me"}' },
        },
      ],
    },
    { role: "tool", tool_call_id: "call_1", content: "Skill instructions" },
  ]);
  assert.deepEqual(response.content, [{ type: "text", text: "Welcome aboard." }]);
  assert.equal(response.stopReason, "end_turn");
});

test("repairs common JSON defects in tool arguments", async () => {
  const provider = new OpenAICompatibleProvider({
    apiKey: "test-key",
    endpoint: "https://gateway.example/v1/chat/completions",
    model: "test-model",
    name: "Test gateway",
    fetch: async () => new Response(
      JSON.stringify({
        choices: [{
          finish_reason: "tool_calls",
          message: {
            tool_calls: [{
              id: "call_repaired",
              function: {
                name: "write_file",
                arguments: '{"path":"index.html","content":"line one\nline two",}',
              },
            }],
          },
        }],
      }),
      { status: 200 },
    ),
  });

  const response = await provider.complete({
    system: "Use tools.",
    messages: [{ role: "user", content: [{ type: "text", text: "Create a page" }] }],
    tools: [],
  });

  assert.deepEqual(response.content, [{
    type: "tool_use",
    id: "call_repaired",
    name: "write_file",
    input: { path: "index.html", content: "line one\nline two" },
  }]);
});

test("streams text from an OpenAI-compatible endpoint", async () => {
  let request: RequestInit | undefined;
  const deltas: string[] = [];
  const body = [
    'data: {"id":"chat_stream","choices":[{"delta":{"content":"Hello"},"finish_reason":null}]}',
    'data: {"id":"chat_stream","choices":[{"delta":{"content":" gateway"},"finish_reason":null}]}',
    'data: {"id":"chat_stream","choices":[{"delta":{},"finish_reason":"stop"}]}',
    'data: {"id":"chat_stream","choices":[],"usage":{"prompt_tokens":8,"completion_tokens":2}}',
    "data: [DONE]",
    "",
  ].join("\n\n");
  const provider = new OpenAICompatibleProvider({
    apiKey: "test-key",
    endpoint: "https://gateway.example/v1/chat/completions",
    model: "test-model",
    name: "Test gateway",
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

  const requestBody = JSON.parse(String(request?.body)) as {
    stream?: boolean;
    stream_options?: { include_usage?: boolean };
  };
  assert.equal(requestBody.stream, true);
  assert.equal(requestBody.stream_options?.include_usage, true);
  assert.deepEqual(deltas, ["Hello", " gateway"]);
  assert.deepEqual(response.content, [{ type: "text", text: "Hello gateway" }]);
  assert.equal(response.stopReason, "end_turn");
  assert.deepEqual(response.usage, { inputTokens: 8, outputTokens: 2 });
});

test("an OpenAI-compatible stream assembles split tool calls", async () => {
  const body = [
    'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","function":{"name":"activate_","arguments":"{\\"name\\":"}}]},"finish_reason":null}]}',
    'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"name":"skill","arguments":"\\"welcome-me\\"}"}}]},"finish_reason":null}]}',
    'data: {"choices":[{"delta":{},"finish_reason":"tool_calls"}]}',
    "data: [DONE]",
    "",
  ].join("\n\n");
  const provider = new OpenAICompatibleProvider({
    apiKey: "test-key",
    endpoint: "https://gateway.example/v1/chat/completions",
    model: "test-model",
    name: "Test gateway",
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
