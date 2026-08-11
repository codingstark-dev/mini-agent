import Anthropic from "@anthropic-ai/sdk";
import type {
  ContentBlockParam,
  MessageParam,
  Tool as AnthropicTool,
} from "@anthropic-ai/sdk/resources/messages/messages";

import type { Provider, ProviderContent, ProviderRequest, ProviderResponse } from "./types.js";

export interface AnthropicProviderOptions {
  apiKey: string;
  model?: string;
  maxTokens?: number;
}

function toAnthropicContent(block: ProviderContent): ContentBlockParam {
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
  private readonly client: Anthropic;
  private readonly model: string;
  private readonly maxTokens: number;

  constructor(options: AnthropicProviderOptions) {
    this.client = new Anthropic({ apiKey: options.apiKey });
    this.model = options.model ?? "claude-sonnet-5";
    this.maxTokens = options.maxTokens ?? 4096;
  }

  async complete(request: ProviderRequest): Promise<ProviderResponse> {
    const messages: MessageParam[] = request.messages.map((message) => ({
      role: message.role,
      content: message.content.map(toAnthropicContent),
    }));
    const tools: AnthropicTool[] = request.tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      input_schema: tool.inputSchema as AnthropicTool.InputSchema,
    }));
    const response = await this.client.messages.create(
      {
        model: this.model,
        max_tokens: this.maxTokens,
        system: request.system,
        messages,
        ...(tools.length > 0 ? { tools } : {}),
      },
      request.signal ? { signal: request.signal } : undefined,
    );
    const content: ProviderResponse["content"] = [];
    for (const block of response.content) {
      if (block.type === "text") {
        content.push({ type: "text", text: block.text });
      }
      if (block.type === "tool_use") {
        content.push({ type: "tool_use", id: block.id, name: block.name, input: block.input });
      }
    }
    const stopReason =
      response.stop_reason === "tool_use" ||
      response.stop_reason === "max_tokens" ||
      response.stop_reason === "refusal" ||
      response.stop_reason === "end_turn"
        ? response.stop_reason
        : "other";
    const requestId = (response as typeof response & { _request_id?: string })._request_id;

    return { content, stopReason, ...(requestId ? { requestId } : {}) };
  }
}
