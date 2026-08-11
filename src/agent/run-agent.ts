import { activateSkill, type ActivatedSkill } from "../skills/activation.js";
import type { SkillCatalog, SkillSummary } from "../skills/discovery.js";
import type {
  Provider,
  ProviderContent,
  ProviderMessage,
  ProviderTool,
  ToolResultBlock,
  ToolUseBlock,
} from "../providers/types.js";

export interface AgentResult {
  text: string;
  activations: string[];
  requestIds: string[];
}

export interface RunAgentOptions {
  prompt: string;
  catalog: SkillCatalog;
  provider: Provider;
  maxTurns?: number;
  signal?: AbortSignal;
  onActivation?: (name: string) => void;
}

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

export function buildSystemPrompt(catalog: SkillCatalog): string {
  const introduction = "You are a concise coding assistant. Answer the user's request directly.";
  if (catalog.skills.length === 0) return introduction;

  const skills = catalog.skills
    .map(
      (skill) =>
        `  <skill>\n    <name>${escapeXml(skill.name)}</name>\n    <description>${escapeXml(skill.description)}</description>\n  </skill>`,
    )
    .join("\n");

  return `${introduction}\n\nThe following skills contain specialized instructions. When a task matches a skill's description, call activate_skill before answering. Do not activate unrelated skills.\n\n<available_skills>\n${skills}\n</available_skills>`;
}

function activationTool(skills: readonly SkillSummary[]): ProviderTool[] {
  if (skills.length === 0) return [];
  return [
    {
      name: "activate_skill",
      description: "Load the complete instructions for one available skill when it matches the user's task.",
      inputSchema: {
        type: "object",
        properties: { name: { type: "string", enum: skills.map((skill) => skill.name) } },
        required: ["name"],
        additionalProperties: false,
      },
    },
  ];
}

function activationContent(skill: ActivatedSkill): string {
  const resources = skill.resources.length > 0 ? skill.resources.map(escapeXml).join("\n") : "(none)";
  return `<activated_skill name="${escapeXml(skill.name)}">\n<directory>${escapeXml(skill.directory)}</directory>\n<instructions>\n${skill.instructions}\n</instructions>\n<available_resources>\n${resources}\n</available_resources>\n</activated_skill>`;
}

function requestedSkill(call: ToolUseBlock): string | undefined {
  if (!call.input || typeof call.input !== "object") return undefined;
  const name = (call.input as Record<string, unknown>).name;
  return typeof name === "string" ? name : undefined;
}

export async function runAgent(options: RunAgentOptions): Promise<AgentResult> {
  const skills = new Map(options.catalog.skills.map((skill) => [skill.name, skill]));
  const active = new Map<string, ActivatedSkill>();
  const messages: ProviderMessage[] = [
    { role: "user", content: [{ type: "text", text: options.prompt }] },
  ];
  const text: string[] = [];
  const requestIds: string[] = [];
  const maxTurns = options.maxTurns ?? 6;

  for (let turn = 0; turn < maxTurns; turn += 1) {
    const response = await options.provider.complete({
      system: buildSystemPrompt(options.catalog),
      messages,
      tools: activationTool(options.catalog.skills),
      ...(options.signal ? { signal: options.signal } : {}),
    });
    if (response.requestId) requestIds.push(response.requestId);
    messages.push({ role: "assistant", content: response.content });

    for (const block of response.content) {
      if (block.type === "text") text.push(block.text);
    }

    const calls = response.content.filter((block): block is ToolUseBlock => block.type === "tool_use");
    if (calls.length === 0) {
      return { text: text.join("\n").trim(), activations: [...active.keys()], requestIds };
    }

    const results: ProviderContent[] = [];
    for (const call of calls) {
      if (call.name !== "activate_skill") {
        results.push({
          type: "tool_result",
          toolUseId: call.id,
          content: `Unknown tool: ${call.name}`,
          isError: true,
        } satisfies ToolResultBlock);
        continue;
      }

      const name = requestedSkill(call);
      const summary = name ? skills.get(name) : undefined;
      if (!name || !summary) {
        results.push({
          type: "tool_result",
          toolUseId: call.id,
          content: "Skill name is not in the available catalog.",
          isError: true,
        } satisfies ToolResultBlock);
        continue;
      }

      const activated = active.get(name) ?? (await activateSkill(summary));
      if (!active.has(name)) {
        active.set(name, activated);
        options.onActivation?.(name);
      }
      results.push({
        type: "tool_result",
        toolUseId: call.id,
        content: activationContent(activated),
      } satisfies ToolResultBlock);
    }
    messages.push({ role: "user", content: results });
  }

  throw new Error(`Agent stopped after ${maxTurns} model turns`);
}
