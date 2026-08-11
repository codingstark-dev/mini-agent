import { activateSkill, readSkillResource, type ActivatedSkill } from "../skills/activation.js";
import type { SkillCatalog, SkillSummary } from "../skills/discovery.js";
import type {
  Provider,
  ProviderContent,
  ProviderMessage,
  ProviderTool,
  ProviderUsage,
  ToolResultBlock,
  ToolUseBlock,
} from "../providers/types.js";
import type { WorkspaceTools } from "../tools/workspace.js";

export interface AgentResult {
  text: string;
  activations: string[];
  requestIds: string[];
  usage: ProviderUsage;
}

export interface ConversationTurn {
  prompt: string;
  answer: string;
}

export type AgentEvent =
  | { type: "model_request"; turn: number }
  | { type: "model_response"; turn: number; stopReason: string; usage?: ProviderUsage }
  | { type: "skill_activated"; name: string }
  | { type: "resource_read"; skill: string; path: string }
  | { type: "subagent_started"; id: string; role: string; task: string }
  | { type: "subagent_completed"; id: string; role: string }
  | { type: "subagent_failed"; id: string; role: string; message: string }
  | { type: "workflow_role_started"; id: string; role: string }
  | { type: "workflow_role_completed"; id: string; role: string }
  | { type: "workflow_verification"; id: string; passed: boolean; detail: string }
  | { type: "tool_repair"; name: string; attempt: number; disabled: boolean }
  | { type: "workspace_tool_started"; id: string; name: string; detail: string }
  | { type: "workspace_tool_completed"; id: string; name: string; detail: string }
  | { type: "workspace_tool_failed"; id: string; name: string; detail: string; message: string }
  | { type: "complete"; turns: number };

export interface RunAgentOptions {
  prompt: string;
  history?: ConversationTurn[];
  catalog: SkillCatalog;
  provider: Provider;
  maxTurns?: number;
  maxSubagents?: number;
  workspaceTools?: WorkspaceTools;
  signal?: AbortSignal;
  onActivation?: (name: string) => void;
  onEvent?: (event: AgentEvent) => void;
  systemGuidance?: string;
}

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

export function buildSystemPrompt(
  catalog: SkillCatalog,
  hasWorkspaceTools = false,
  systemGuidance?: string,
): string {
  const workspaceGuidance = hasWorkspaceTools
    ? " When the user asks you to inspect or change project files, use the workspace tools instead of guessing. After a change, report the paths you changed."
    : "";
  const introduction = `You are a concise coding assistant. Answer the user's request directly. For simple questions, answer directly without delegating. Subagents have no tools or external access; use them only for bounded analysis that can be completed from the supplied context.${workspaceGuidance}${systemGuidance ? `\n\n${systemGuidance}` : ""}`;
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

function workspaceToolDetail(call: ToolUseBlock): string {
  if (!call.input || typeof call.input !== "object") return call.name;
  const input = call.input as Record<string, unknown>;
  const target = typeof input.path === "string"
    ? input.path
    : typeof input.pattern === "string"
      ? input.pattern
      : "workspace";
  return `${call.name} ${target}`;
}

function addUsage(total: ProviderUsage, addition: ProviderUsage | undefined): void {
  if (!addition) return;
  total.inputTokens += addition.inputTokens;
  total.outputTokens += addition.outputTokens;
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
  const usage: ProviderUsage = { inputTokens: 0, outputTokens: 0 };
  const maxSubagents = Math.max(0, Math.floor(options.maxSubagents ?? 2));
  const maxTurns = options.maxTurns ?? Math.max(6, maxSubagents + 4);
  let subagentsUsed = 0;
  const disabledTools = new Set<string>();
  const toolFailures = new Map<string, number>();

  function repairToolFailure(
    call: ToolUseBlock,
    message: string,
    tool: ProviderTool | undefined,
  ): ToolResultBlock {
    const signature = `${call.name}:${JSON.stringify(call.input)}`;
    const attempt = (toolFailures.get(signature) ?? 0) + 1;
    toolFailures.set(signature, attempt);
    const disabled = attempt >= 2;
    if (disabled) disabledTools.add(call.name);
    options.onEvent?.({ type: "tool_repair", name: call.name, attempt, disabled });
    const guidance = disabled
      ? `The same invalid call was repeated, so ${call.name} is disabled for this run. Continue without it or explain the limitation.`
      : tool
        ? `Repair the arguments and retry once using this schema: ${JSON.stringify(tool.inputSchema)}`
        : "Use one of the tools currently provided, or answer without a tool.";
    return {
      type: "tool_result",
      toolUseId: call.id,
      content: `${message} ${guidance}`,
      isError: true,
    };
  }

  for (let turn = 0; turn < maxTurns; turn += 1) {
    const availableTools = [
      ...activationTool(options.catalog.skills),
      ...resourceTool(active),
      ...delegationTool(maxSubagents - subagentsUsed),
      ...(options.workspaceTools?.tools ?? []),
    ].filter((tool) => !disabledTools.has(tool.name));
    options.onEvent?.({ type: "model_request", turn: turn + 1 });
    const response = await options.provider.complete({
      system: buildSystemPrompt(options.catalog, Boolean(options.workspaceTools), options.systemGuidance),
      messages,
      tools: availableTools,
      ...(options.signal ? { signal: options.signal } : {}),
    });
    addUsage(usage, response.usage);
    options.onEvent?.({
      type: "model_response",
      turn: turn + 1,
      stopReason: response.stopReason,
      ...(response.usage ? { usage: response.usage } : {}),
    });
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
      return { text: responseText, activations: [...active.keys()], requestIds, usage };
    }

    const results: ProviderContent[] = [];
    for (const call of calls) {
      if (options.workspaceTools?.tools.some((tool) => tool.name === call.name)) {
        const detail = workspaceToolDetail(call);
        options.onEvent?.({ type: "workspace_tool_started", id: call.id, name: call.name, detail });
        try {
          const executed = await options.workspaceTools.execute(call.name, call.input, options.signal);
          results.push({
            type: "tool_result",
            toolUseId: call.id,
            content: executed.content,
          } satisfies ToolResultBlock);
          options.onEvent?.({
            type: "workspace_tool_completed",
            id: call.id,
            name: call.name,
            detail: executed.summary,
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          results.push(repairToolFailure(
            call,
            message,
            availableTools.find((tool) => tool.name === call.name),
          ));
          options.onEvent?.({ type: "workspace_tool_failed", id: call.id, name: call.name, detail, message });
        }
        continue;
      }

      if (call.name === "delegate_task") {
        const requested = requestedDelegation(call);
        if (!requested) {
          results.push(repairToolFailure(
            call,
            "Subagent delegation requires a role and a self-contained task.",
            availableTools.find((tool) => tool.name === call.name),
          ));
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
          addUsage(usage, delegated.usage);
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
          results.push(repairToolFailure(
            call,
            error instanceof Error ? error.message : String(error),
            availableTools.find((tool) => tool.name === call.name),
          ));
        }
        continue;
      }

      if (call.name !== "activate_skill") {
        results.push(repairToolFailure(call, `Unknown tool: ${call.name}.`, undefined));
        continue;
      }

      const name = requestedSkill(call);
      const summary = name ? skills.get(name) : undefined;
      if (!name || !summary) {
        results.push(repairToolFailure(
          call,
          "Skill name is not in the available catalog.",
          availableTools.find((tool) => tool.name === call.name),
        ));
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
