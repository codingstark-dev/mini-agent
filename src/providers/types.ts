export interface TextBlock {
  type: "text";
  text: string;
}

export interface ToolUseBlock {
  type: "tool_use";
  id: string;
  name: string;
  input: unknown;
}

export interface ToolResultBlock {
  type: "tool_result";
  toolUseId: string;
  content: string;
  isError?: boolean;
}

export type ProviderContent = TextBlock | ToolUseBlock | ToolResultBlock;

export interface ProviderMessage {
  role: "user" | "assistant";
  content: ProviderContent[];
}

export interface ProviderTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface ProviderRequest {
  system: string;
  messages: ProviderMessage[];
  tools: ProviderTool[];
  signal?: AbortSignal;
}

export interface ProviderResponse {
  content: Array<TextBlock | ToolUseBlock>;
  stopReason: "end_turn" | "tool_use" | "max_tokens" | "refusal";
  requestId?: string;
}

export interface Provider {
  complete(request: ProviderRequest): Promise<ProviderResponse>;
}
