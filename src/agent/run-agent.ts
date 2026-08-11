import { activateSkill, readSkillResource, type ActivatedSkill } from "../skills/activation.js";
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

export interface ConversationTurn {
  prompt: string;
  answer: string;
}

export type AgentEvent =
  | { type: "model_request"; turn: number }
  | { type: "model_response"; turn: number; stopReason: string }
  | { type: "skill_activated"; name: string }
  | { type: "resource_read"; skill: string; path: string }
  | { type: "subagent_started"; id: string; role: string; task: string }
  | { type: "subagent_completed"; id: string; role: string }
  | { type: "subagent_failed"; id: string; role: string; message: string }
  | { type: "complete"; turns: number };

export interface RunAgentOptions {
  prompt: string;
  history?: ConversationTurn[];
  catalog: SkillCatalog;
  provider: Provider;
  maxTurns?: number;
  maxSubagents?: number;
  signal?: AbortSignal;
  onActivation?: (name: string) => void;
  onEvent?: (event: AgentEvent) => void;
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

function resourceTool(active: ReadonlyMap<string, ActivatedSkill>): ProviderTool[] {
  if (active.size === 0) return [];
  return [
    {
      name: "read_skill_resource",
      description: "Read one referenced file from an active skill. Paths are relative to that skill's directory.",
      inputSchema: {
        type: "object",
        properties: {
          skill: { type: "string", enum: [...active.keys()] },
          path: { type: "string" },
        },
        required: ["skill", "path"],
        additionalProperties: false,
      },
    },
  ];
}

function delegationTool(maxSubagents: number): ProviderTool[] {
  if (maxSubagents === 0) return [];
  return [
    {
      name: "delegate_task",
      description: "Delegate one bounded, independent analysis task to an isolated subagent. Use sparingly when parallel expertise would materially improve the answer.",
      inputSchema: {
        type: "object",
        properties: {
          role: { type: "string", description: "A short specialist role, such as reviewer or researcher." },
          task: { type: "string", description: "The complete, self-contained task for the subagent." },
        },
        required: ["role", "task"],
        additionalProperties: false,
      },
    },
  ];
}

function activationContent(skill: ActivatedSkill): string {
  const resources = skill.resources.length > 0 ? skill.resources.map(escapeXml).join("\n") : "(none)";
  return `<activated_skill name="${escapeXml(skill.name)}">\n<instructions>\n${skill.instructions}\n</instructions>\n<available_resources>\n${resources}\n</available_resources>\n</activated_skill>`;
}

function requestedSkill(call: ToolUseBlock): string | undefined {
  if (!call.input || typeof call.input !== "object") return undefined;
  const name = (call.input as Record<string, unknown>).name;
  return typeof name === "string" ? name : undefined;
}

function requestedResource(call: ToolUseBlock): { skill: string; path: string } | undefined {
  if (!call.input || typeof call.input !== "object") return undefined;
  const { skill, path } = call.input as Record<string, unknown>;
  return typeof skill === "string" && typeof path === "string" ? { skill, path } : undefined;
}

function requestedDelegation(call: ToolUseBlock): { role: string; task: string } | undefined {
  if (!call.input || typeof call.input !== "object") return undefined;
  const { role, task } = call.input as Record<string, unknown>;
  return typeof role === "string" && role.trim() && typeof task === "string" && task.trim()
    ? { role: role.trim(), task: task.trim() }
    : undefined;
}

export async function runAgent(options: RunAgentOptions): Promise<AgentResult> {
  const skills = new Map(options.catalog.skills.map((skill) => [skill.name, skill]));
  const active = new Map<string, ActivatedSkill>();
  const initialContent: ProviderContent[] = [];
  const explicit = /^\/([a-z0-9]+(?:-[a-z0-9]+)*)(?:\s+|$)/.exec(options.prompt);
  const explicitSummary = explicit?.[1] ? skills.get(explicit[1]) : undefined;
  if (explicit?.[0] && explicitSummary) {
    const activated = await activateSkill(explicitSummary);
    active.set(activated.name, activated);
    options.onActivation?.(activated.name);
    options.onEvent?.({ type: "skill_activated", name: activated.name });
    const remainingPrompt = options.prompt.slice(explicit[0].length).trim();
    initialContent.push({ type: "text", text: remainingPrompt || "Follow the explicitly activated skill." });
    initialContent.push({ type: "text", text: activationContent(activated) });
  } else {
    initialContent.push({ type: "text", text: options.prompt });
  }
  const messages: ProviderMessage[] = [
    ...(options.history ?? []).flatMap<ProviderMessage>((turn) => [
      { role: "user", content: [{ type: "text", text: turn.prompt }] },
      { role: "assistant", content: [{ type: "text", text: turn.answer }] },
    ]),
    { role: "user", content: initialContent },
  ];
  const requestIds: string[] = [];
  const maxTurns = options.maxTurns ?? 6;
  const maxSubagents = Math.max(0, Math.floor(options.maxSubagents ?? 2));
  let subagentsUsed = 0;

  for (let turn = 0; turn < maxTurns; turn += 1) {
    options.onEvent?.({ type: "model_request", turn: turn + 1 });
    const response = await options.provider.complete({
      system: buildSystemPrompt(options.catalog),
      messages,
      tools: [
        ...activationTool(options.catalog.skills),
        ...resourceTool(active),
        ...delegationTool(maxSubagents),
      ],
      ...(options.signal ? { signal: options.signal } : {}),
    });
    options.onEvent?.({ type: "model_response", turn: turn + 1, stopReason: response.stopReason });
    if (response.requestId) requestIds.push(response.requestId);
    messages.push({ role: "assistant", content: response.content });

    const responseText = response.content
      .flatMap((block) => (block.type === "text" ? [block.text] : []))
      .join("\n")
      .trim();

    const calls = response.content.filter((block): block is ToolUseBlock => block.type === "tool_use");
    if (calls.length === 0) {
      if (response.stopReason === "max_tokens") {
        throw new Error("Claude reached its maximum output length before completing the answer");
      }
      if (response.stopReason === "other" || response.stopReason === "tool_use") {
        throw new Error(`Claude stopped unexpectedly (${response.stopReason})`);
      }
      options.onEvent?.({ type: "complete", turns: turn + 1 });
      return { text: responseText, activations: [...active.keys()], requestIds };
    }

    const results: ProviderContent[] = [];
    for (const call of calls) {
      if (call.name === "delegate_task") {
        const requested = requestedDelegation(call);
        if (!requested) {
          results.push({
            type: "tool_result",
            toolUseId: call.id,
            content: "Subagent delegation requires a role and a self-contained task.",
            isError: true,
          } satisfies ToolResultBlock);
          continue;
        }
        if (subagentsUsed >= maxSubagents) {
          results.push({
            type: "tool_result",
            toolUseId: call.id,
            content: `Subagent limit reached (${maxSubagents}).`,
            isError: true,
          } satisfies ToolResultBlock);
          continue;
        }
        subagentsUsed += 1;
        options.onEvent?.({
          type: "subagent_started",
          id: call.id,
          role: requested.role,
          task: requested.task,
        });
        try {
          const delegated = await options.provider.complete({
            system: `You are a focused ${requested.role} subagent. Complete only the assigned task and return concise findings to the main agent. Do not delegate further.`,
            messages: [{ role: "user", content: [{ type: "text", text: requested.task }] }],
            tools: [],
            ...(options.signal ? { signal: options.signal } : {}),
          });
          if (delegated.requestId) requestIds.push(delegated.requestId);
          const findings = delegated.content
            .flatMap((block) => (block.type === "text" ? [block.text] : []))
            .join("\n")
            .trim();
          if (!findings || delegated.stopReason === "max_tokens" || delegated.stopReason === "other") {
            throw new Error(`Subagent stopped without complete findings (${delegated.stopReason})`);
          }
          results.push({
            type: "tool_result",
            toolUseId: call.id,
            content: findings,
          } satisfies ToolResultBlock);
          options.onEvent?.({
            type: "subagent_completed",
            id: call.id,
            role: requested.role,
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          results.push({
            type: "tool_result",
            toolUseId: call.id,
            content: message,
            isError: true,
          } satisfies ToolResultBlock);
          options.onEvent?.({
            type: "subagent_failed",
            id: call.id,
            role: requested.role,
            message,
          });
        }
        continue;
      }

      if (call.name === "read_skill_resource") {
        const requested = requestedResource(call);
        const skill = requested ? active.get(requested.skill) : undefined;
        try {
          if (!requested || !skill) throw new Error("Resource reads require an active skill and relative path");
          const content = await readSkillResource(skill, requested.path);
          results.push({
            type: "tool_result",
            toolUseId: call.id,
            content,
          } satisfies ToolResultBlock);
          options.onEvent?.({ type: "resource_read", skill: requested.skill, path: requested.path });
        } catch (error) {
          results.push({
            type: "tool_result",
            toolUseId: call.id,
            content: error instanceof Error ? error.message : String(error),
            isError: true,
          } satisfies ToolResultBlock);
        }
        continue;
      }

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
        options.onEvent?.({ type: "skill_activated", name });
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
