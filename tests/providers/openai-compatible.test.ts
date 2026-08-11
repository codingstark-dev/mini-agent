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
