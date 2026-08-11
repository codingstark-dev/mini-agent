import type {
  Provider,
  ProviderContent,
  ProviderMessage,
  ProviderRequest,
  ProviderResponse,
} from "./types.js";

export interface OpenAICompatibleProviderOptions {
  apiKey: string;
  endpoint: string;
  model: string;
  name: string;
  maxTokens?: number;
  headers?: Record<string, string>;
  fetch?: typeof globalThis.fetch;
}

interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_call_id?: string;
  tool_calls?: Array<{
    id: string;
    type: "function";
    function: { name: string; arguments: string };
  }>;
}

function textContent(content: ProviderContent[]): string {
  return content
    .filter((block): block is Extract<ProviderContent, { type: "text" }> => block.type === "text")
    .map((block) => block.text)
    .join("\n\n");
}

function chatMessages(message: ProviderMessage): ChatMessage[] {
  if (message.role === "assistant") {
    const text = textContent(message.content);
    const toolCalls = message.content
      .filter((block): block is Extract<ProviderContent, { type: "tool_use" }> => block.type === "tool_use")
      .map((block) => ({
        id: block.id,
        type: "function" as const,
        function: { name: block.name, arguments: JSON.stringify(block.input ?? {}) },
      }));
    return [
      {
        role: "assistant",
        content: text || null,
        ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
      },
    ];
  }

  const messages: ChatMessage[] = [];
  const text = textContent(message.content);
  if (text) messages.push({ role: "user", content: text });
  for (const block of message.content) {
    if (block.type === "tool_result") {
      messages.push({ role: "tool", tool_call_id: block.toolUseId, content: block.content });
    }
  }
  return messages;
}

function stopReason(reason: string | null | undefined): ProviderResponse["stopReason"] {
  if (reason === "tool_calls") return "tool_use";
  if (reason === "stop") return "end_turn";
  if (reason === "length") return "max_tokens";
  if (reason === "content_filter") return "refusal";
  return "other";
}

export class OpenAICompatibleProvider implements Provider {
  private readonly options: Required<Pick<OpenAICompatibleProviderOptions, "maxTokens">> &
    Omit<OpenAICompatibleProviderOptions, "maxTokens" | "fetch">;
  private readonly fetch: typeof globalThis.fetch;

  constructor(options: OpenAICompatibleProviderOptions) {
    this.options = { ...options, maxTokens: options.maxTokens ?? 4096 };
    this.fetch = options.fetch ?? globalThis.fetch;
  }

  async complete(request: ProviderRequest): Promise<ProviderResponse> {
    const response = await this.fetch(this.options.endpoint, {
      method: "POST",
      headers: {
        authorization: `Bearer ${this.options.apiKey}`,
        "content-type": "application/json",
        ...this.options.headers,
      },
      body: JSON.stringify({
        model: this.options.model,
        max_tokens: this.options.maxTokens,
        stream: false,
        messages: [
          { role: "system", content: request.system },
          ...request.messages.flatMap(chatMessages),
        ],
        ...(request.tools.length > 0
          ? {
              tools: request.tools.map((tool) => ({
                type: "function",
                function: {
                  name: tool.name,
                  description: tool.description,
                  parameters: tool.inputSchema,
                },
              })),
            }
          : {}),
      }),
      ...(request.signal ? { signal: request.signal } : {}),
    });

    const requestId =
      response.headers.get("x-request-id") ?? response.headers.get("request-id") ?? undefined;
    if (!response.ok) {
      const details = (await response.text()).slice(0, 500);
      throw new Error(
        `${this.options.name} returned ${response.status}${details ? `: ${details}` : ""}`,
      );
    }

    const payload = (await response.json()) as {
      id?: string;
      choices?: Array<{
        finish_reason?: string | null;
        message?: {
          content?: string | null;
          tool_calls?: Array<{
            id?: string;
            function?: { name?: string; arguments?: string };
          }>;
        };
      }>;
    };
    const choice = payload.choices?.[0];
    if (!choice?.message) throw new Error(`${this.options.name} returned no response message`);

    const content: ProviderResponse["content"] = [];
    if (choice.message.content) content.push({ type: "text", text: choice.message.content });
    for (const call of choice.message.tool_calls ?? []) {
      if (!call.id || !call.function?.name) continue;
      let input: unknown = {};
      try {
        input = JSON.parse(call.function.arguments || "{}");
      } catch {
        throw new Error(`${this.options.name} returned invalid arguments for ${call.function.name}`);
      }
      content.push({ type: "tool_use", id: call.id, name: call.function.name, input });
    }

    const resolvedRequestId = requestId ?? payload.id;
    return {
      content,
      stopReason: stopReason(choice.finish_reason),
      ...(resolvedRequestId ? { requestId: resolvedRequestId } : {}),
    };
  }
}
