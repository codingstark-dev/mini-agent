import type { Provider, ProviderContent, ProviderRequest, ProviderResponse } from "./types.js";

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

    const payload = (await response.json()) as {
      content?: Array<{ type?: string; text?: string; id?: string; name?: string; input?: unknown }>;
      stop_reason?: string;
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
    const knownReasons = ["end_turn", "tool_use", "max_tokens", "refusal"] as const;
    const stopReason = knownReasons.find((reason) => reason === payload.stop_reason) ?? "other";
    return { content, stopReason, ...(requestId ? { requestId } : {}) };
  }
}
