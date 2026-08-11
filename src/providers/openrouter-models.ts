export interface OpenRouterModel {
  id: string;
  name: string;
  contextLength?: number;
  promptPrice?: number;
  completionPrice?: number;
}

interface OpenRouterModelPayload {
  id?: string;
  name?: string;
  context_length?: number;
  pricing?: {
    prompt?: string;
    completion?: string;
  };
}

function pricePerMillion(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const price = Number(value) * 1_000_000;
  return Number.isFinite(price) ? price : undefined;
}

export async function fetchOpenRouterModels(
  apiKey: string,
  fetcher: typeof globalThis.fetch = globalThis.fetch,
  signal?: AbortSignal,
): Promise<OpenRouterModel[]> {
  const endpoint =
    "https://openrouter.ai/api/v1/models?supported_parameters=tools&sort=most-popular";
  const response = await fetcher(endpoint, {
    headers: { authorization: `Bearer ${apiKey}` },
    ...(signal ? { signal } : {}),
  });
  if (!response.ok) {
    const details = (await response.text()).slice(0, 500);
    throw new Error(`OpenRouter model catalog returned ${response.status}${details ? `: ${details}` : ""}`);
  }

  const payload = (await response.json()) as { data?: OpenRouterModelPayload[] };
  return (payload.data ?? []).flatMap((model) => {
    if (!model.id) return [];
    const contextLength =
      typeof model.context_length === "number" ? model.context_length : undefined;
    const promptPrice = pricePerMillion(model.pricing?.prompt);
    const completionPrice = pricePerMillion(model.pricing?.completion);
    return [{
      id: model.id,
      name: model.name || model.id,
      ...(contextLength === undefined ? {} : { contextLength }),
      ...(promptPrice === undefined ? {} : { promptPrice }),
      ...(completionPrice === undefined ? {} : { completionPrice }),
    }];
  });
}
