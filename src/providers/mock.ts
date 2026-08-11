import type { Provider, ProviderRequest, ProviderResponse } from "./types.js";

function text(response: string): ProviderResponse {
  return { content: [{ type: "text", text: response }], stopReason: "end_turn" };
}

export class DemoProvider implements Provider {
  async complete(request: ProviderRequest): Promise<ProviderResponse> {
    const toolResults = request.messages.flatMap((message) =>
      message.content.flatMap((block) => (block.type === "tool_result" ? [block.content] : [])),
    );
    if (toolResults.some((result) => result.includes('<activated_skill name="welcome-me">'))) {
      return text("> Welcome to our agent!\nWe're glad to have you here. Start by reading the README, running the tests, and choosing one small issue to understand end to end.");
    }
    if (toolResults.some((result) => result.includes('<activated_skill name="changelog-generator">'))) {
      return text("# Changes\n\n## Improvements\n\n- Turned recent development work into concise, customer-facing release notes.");
    }
    if (toolResults.some((result) => result.includes('<activated_skill name="internal-comms">'))) {
      return text("## Progress\n\nShare the concrete outcomes completed this week.\n\n## Plans\n\nList the next measurable steps.\n\n## Problems\n\nCall out blockers and owners.");
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

    if (selection) {
      return {
        content: [{ type: "tool_use", id: `demo-${selection}`, name: "activate_skill", input: { name: selection } }],
        stopReason: "tool_use",
      };
    }

    return text("The demo provider only simulates skill selection. Set ANTHROPIC_API_KEY to ask Claude.");
  }
}
