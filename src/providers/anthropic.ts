import type { Provider, ProviderContent, ProviderRequest, ProviderResponse } from "./types.js";
import { eventStreamData } from "./event-stream.js";

export interface AnthropicProviderOptions {
  apiKey: string;
  model?: string;
  maxTokens?: number;
  fetch?: typeof globalThis.fetch;
}

function apiContent(block: ProviderContent): Record<string, unknown> {
  switch (block.type) {
    case "text":
      return { type: "text", text: block.text };
    case "tool_use":
      return { type: "tool_use", id: block.id, name: block.name, input: block.input };
    case "tool_result":
      return {
        type: "tool_result",
        tool_use_id: block.toolUseId,
        content: block.content,
        ...(block.isError === undefined ? {} : { is_error: block.isError }),
      };
  }
}

function anthropicStopReason(value: string | null | undefined): ProviderResponse["stopReason"] {
  if (value === "end_turn") return "end_turn";
  if (value === "tool_use") return "tool_use";
  if (value === "max_tokens") return "max_tokens";
  if (value === "refusal") return "refusal";
  return "other";
}

interface StreamingBlock {
  type: "text" | "tool_use";
  text: string;
  id: string;
  name: string;
  input: string;
}

async function streamingResponse(
  response: Response,
  request: ProviderRequest,
  requestId: string | undefined,
): Promise<ProviderResponse> {
  const blocks = new Map<number, StreamingBlock>();
  let stopReason: ProviderResponse["stopReason"] = "other";
  let inputTokens = 0;
  let outputTokens = 0;

  for await (const data of eventStreamData(response)) {
    const event = JSON.parse(data) as {
      type?: string;
      index?: number;
      message?: { usage?: { input_tokens?: number } };
      content_block?: { type?: string; text?: string; id?: string; name?: string };
      delta?: { type?: string; text?: string; partial_json?: string; stop_reason?: string };
      usage?: { output_tokens?: number };
      error?: { message?: string };
    };
    if (event.type === "error") {
      throw new Error(`Claude stream failed${event.error?.message ? `: ${event.error.message}` : ""}`);
    }
    if (event.type === "message_start") inputTokens = event.message?.usage?.input_tokens ?? 0;
    if (event.type === "content_block_start" && typeof event.index === "number") {
      const block = event.content_block;
      blocks.set(event.index, {
        type: block?.type === "tool_use" ? "tool_use" : "text",
        text: block?.text ?? "",
        id: block?.id ?? "",
        name: block?.name ?? "",
        input: "",
      });
    }
    if (event.type === "content_block_delta" && typeof event.index === "number") {
      const block = blocks.get(event.index);
      if (!block) continue;
      const delta = event.delta;
      if (delta?.type === "text_delta" && delta.text) {
        block.text += delta.text;
        request.onTextDelta?.(delta.text);
      }
      if (delta?.type === "input_json_delta") block.input += delta.partial_json ?? "";
    }
    if (event.type === "message_delta") {
      stopReason = anthropicStopReason(event.delta?.stop_reason);
      outputTokens = event.usage?.output_tokens ?? outputTokens;
    }
  }

  const content: ProviderResponse["content"] = [];
  for (const [, block] of [...blocks.entries()].sort(([left], [right]) => left - right)) {
    if (block.type === "text" && block.text) content.push({ type: "text", text: block.text });
    if (block.type === "tool_use" && block.id && block.name) {
      content.push({
        type: "tool_use",
        id: block.id,
        name: block.name,
        input: JSON.parse(block.input || "{}") as unknown,
      });
    }
  }
  return {
    content,
    stopReason,
    ...(requestId ? { requestId } : {}),
    usage: { inputTokens, outputTokens },
  };
}

export class AnthropicProvider implements Provider {
  private readonly apiKey: string;
  private readonly model: string;
  private readonly maxTokens: number;
  private readonly fetch: typeof globalThis.fetch;

  constructor(options: AnthropicProviderOptions) {
    this.apiKey = options.apiKey;
    this.model = options.model ?? "claude-sonnet-5";
    this.maxTokens = options.maxTokens ?? 4096;
    this.fetch = options.fetch ?? globalThis.fetch;
  }

  async complete(request: ProviderRequest): Promise<ProviderResponse> {
    const response = await this.fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
        "x-api-key": this.apiKey,
      },
      body: JSON.stringify({
        model: this.model,
        max_tokens: this.maxTokens,
        ...(request.onTextDelta ? { stream: true } : {}),
        system: request.system,
        messages: request.messages.map((message) => ({
          role: message.role,
          content: message.content.map(apiContent),
        })),
        ...(request.tools.length > 0
          ? {
              tools: request.tools.map((tool) => ({
                name: tool.name,
                description: tool.description,
                input_schema: tool.inputSchema,
              })),
            }
          : {}),
      }),
      ...(request.signal ? { signal: request.signal } : {}),
    });

    const requestId = response.headers.get("request-id") ?? undefined;
    if (!response.ok) {
      const details = (await response.text()).slice(0, 500);
      throw new Error(`Claude API returned ${response.status}${details ? `: ${details}` : ""}`);
    }
    if (request.onTextDelta) return streamingResponse(response, request, requestId);

    const payload = (await response.json()) as {
      content?: Array<{ type?: string; text?: string; id?: string; name?: string; input?: unknown }>;
      stop_reason?: string;
      usage?: { input_tokens?: number; output_tokens?: number };
    };
    const content: ProviderResponse["content"] = [];
    for (const block of payload.content ?? []) {
      if (block.type === "text" && typeof block.text === "string") {
        content.push({ type: "text", text: block.text });
      }
      if (block.type === "tool_use" && block.id && block.name) {
        content.push({ type: "tool_use", id: block.id, name: block.name, input: block.input });
      }
    }
    const stopReason = anthropicStopReason(payload.stop_reason);
    const inputTokens = payload.usage?.input_tokens;
    const outputTokens = payload.usage?.output_tokens;
    return {
      content,
      stopReason,
      ...(requestId ? { requestId } : {}),
      ...(typeof inputTokens === "number" && typeof outputTokens === "number"
        ? { usage: { inputTokens, outputTokens } }
        : {}),
    };
  }
}
