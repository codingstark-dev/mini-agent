import assert from "node:assert/strict";
import test from "node:test";

import { fetchOpenRouterModels } from "../../src/providers/openrouter-models.js";

test("fetches tool-capable OpenRouter models for the picker", async () => {
  let requestedUrl = "";
  let request: RequestInit | undefined;
  const models = await fetchOpenRouterModels("test-key", async (input, init) => {
    requestedUrl = String(input);
    request = init;
    return new Response(
      JSON.stringify({
        data: [
          {
            id: "deepseek/deepseek-v4-flash",
            name: "DeepSeek: DeepSeek V4 Flash",
            context_length: 1_048_576,
            pricing: { prompt: "0.00000009", completion: "0.00000018" },
          },
        ],
      }),
      { status: 200 },
    );
  });

  assert.equal(
    requestedUrl,
    "https://openrouter.ai/api/v1/models?supported_parameters=tools&sort=most-popular",
  );
  assert.equal((request?.headers as Record<string, string>).authorization, "Bearer test-key");
  assert.deepEqual(models, [
    {
      id: "deepseek/deepseek-v4-flash",
      name: "DeepSeek: DeepSeek V4 Flash",
      contextLength: 1_048_576,
      promptPrice: 0.09,
      completionPrice: 0.18,
    },
  ]);
});
