import { AnthropicProvider } from "./anthropic.js";
import { OpenAICompatibleProvider } from "./openai-compatible.js";
import type { Provider } from "./types.js";

export type ProviderName = "anthropic" | "openrouter" | "vercel";

interface ProviderSettings {
  defaultModel: string;
  key: "ANTHROPIC_API_KEY" | "OPENROUTER_API_KEY" | "AI_GATEWAY_API_KEY";
  label: string;
}

const settings: Record<ProviderName, ProviderSettings> = {
  anthropic: {
    defaultModel: "claude-sonnet-5",
    key: "ANTHROPIC_API_KEY",
    label: "Anthropic",
  },
  openrouter: {
    defaultModel: "anthropic/claude-sonnet-4.6",
    key: "OPENROUTER_API_KEY",
    label: "OpenRouter",
  },
  vercel: {
    defaultModel: "anthropic/claude-sonnet-4.6",
    key: "AI_GATEWAY_API_KEY",
    label: "Vercel AI Gateway",
  },
};

export function parseProviderName(value: string): ProviderName {
  if (value === "anthropic" || value === "openrouter" || value === "vercel") return value;
  throw new Error(`Unknown provider: ${value}. Choose anthropic, openrouter, or vercel.`);
}

export function defaultModelFor(provider: ProviderName): string {
  return settings[provider].defaultModel;
}

export function providerLabel(provider: ProviderName): string {
  return settings[provider].label;
}

export function createProvider(
  provider: ProviderName,
  model: string,
  environment: NodeJS.ProcessEnv = process.env,
): Provider {
  const providerSettings = settings[provider];
  const apiKey = environment[providerSettings.key];
  if (!apiKey) {
    throw new Error(`Set ${providerSettings.key} or use --mock for the offline demo.`);
  }

  if (provider === "anthropic") return new AnthropicProvider({ apiKey, model });
  if (provider === "openrouter") {
    return new OpenAICompatibleProvider({
      apiKey,
      endpoint: "https://openrouter.ai/api/v1/chat/completions",
      model,
      name: providerSettings.label,
      headers: { "X-OpenRouter-Title": "mini-agent" },
    });
  }
  return new OpenAICompatibleProvider({
    apiKey,
    endpoint: "https://ai-gateway.vercel.sh/v1/chat/completions",
    model,
    name: providerSettings.label,
  });
}
