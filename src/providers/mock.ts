import type { Provider, ProviderRequest, ProviderResponse } from "./types.js";

function text(response: string): ProviderResponse {
  return { content: [{ type: "text", text: response }], stopReason: "end_turn" };
}

const demoPage = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Mini agent</title>
  <style>
    body { font: 18px/1.6 system-ui, sans-serif; max-width: 48rem; margin: 12vh auto; padding: 0 1.5rem; color: #17202a; }
    h1 { font-size: clamp(2.5rem, 8vw, 5rem); line-height: 1; margin-bottom: 1rem; }
  </style>
</head>
<body>
  <main>
    <h1>Mini agent</h1>
    <p>This page was created through a sandboxed workspace tool.</p>
  </main>
</body>
</html>
`;

export class DemoProvider implements Provider {
  async complete(request: ProviderRequest): Promise<ProviderResponse> {
    const toolResults = request.messages.flatMap((message) =>
      message.content.flatMap((block) => (block.type === "tool_result" ? [block.content] : [])),
    );
    if (toolResults.some((result) => result.includes('<activated_skill name="welcome-me">'))) {
      return text("> Welcome to our Command Code assignment agent!\nWe're glad to have you here. Start by reading the README, running the tests, and choosing one small issue to understand end to end.");
    }
    if (toolResults.some((result) => result.includes('<activated_skill name="changelog-generator">'))) {
      return text("# Changes\n\n## Improvements\n\n- Turned recent development work into concise, customer-facing release notes.");
    }
    if (toolResults.some((result) => result.includes('<activated_skill name="internal-comms">'))) {
      return text("## Progress\n\nShare the concrete outcomes completed this week.\n\n## Plans\n\nList the next measurable steps.\n\n## Problems\n\nCall out blockers and owners.");
    }
    if (toolResults.some((result) => /Wrote \d+ bytes to index\.html/.test(result))) {
      return text("Created index.html through the write_file workspace tool.");
    }

    const firstMessage = request.messages[0]?.content[0];
    const prompt = firstMessage?.type === "text" ? firstMessage.text : "";
    const selection = /\b(new|welcome|onboard|getting started)\b/i.test(prompt)
      ? "welcome-me"
      : /\b(changelog|release notes?|commits?)\b/i.test(prompt)
        ? "changelog-generator"
        : /\b(status report|leadership update|newsletter|internal comms?|3p update)\b/i.test(prompt)
          ? "internal-comms"
          : undefined;

    if (/\b(create|build|make)\b.*\bhtml\b|\bhtml\b.*\b(page|site)\b/i.test(prompt)) {
      if (!request.tools.some((tool) => tool.name === "write_file")) {
        return text("The workspace is read-only, so index.html was not created.");
      }
      return {
        content: [{
          type: "tool_use",
          id: "demo-write-page",
          name: "write_file",
          input: { path: "index.html", content: demoPage },
        }],
        stopReason: "tool_use",
      };
    }

    if (selection) {
      return {
        content: [{ type: "tool_use", id: `demo-${selection}`, name: "activate_skill", input: { name: selection } }],
        stopReason: "tool_use",
      };
    }

    return text("The demo provider only simulates skill selection. Set ANTHROPIC_API_KEY to ask Claude.");
  }
}
