import { exec } from "node:child_process";

import { nativeRoles } from "../../agents/index.js";
import { runAgent, type AgentEvent } from "../agent/run-agent.js";
import type { Provider, ProviderUsage } from "../providers/types.js";
import type { SkillCatalog } from "../skills/discovery.js";
import { WorkspaceTools } from "../tools/workspace.js";

export interface WorkflowStep {
  id: string;
  title: string;
  instructions: string;
  verification: string;
  status: "pending" | "passed";
  attempts: number;
}

export interface NativeWorkflowState {
  version: 1;
  task: string;
  summary: string;
  status: "planned" | "failed" | "passed";
  createdAt: string;
  updatedAt: string;
  steps: WorkflowStep[];
  latestVerification?: {
    stepId: string;
    passed: boolean;
    evidence: string;
  };
}

interface WorkflowBaseOptions {
  catalog: SkillCatalog;
  provider: Provider;
  workspaceTools: WorkspaceTools;
  signal?: AbortSignal;
  onEvent?: (event: AgentEvent) => void;
  now?: Date;
}

export interface WorkflowResult {
  state: NativeWorkflowState;
  text: string;
  activity: AgentEvent[];
  usage: ProviderUsage;
}

interface PlanShape {
  summary: string;
  steps: Array<Pick<WorkflowStep, "title" | "instructions" | "verification">>;
}

const EMPTY_USAGE: ProviderUsage = { inputTokens: 0, outputTokens: 0 };

function usageSum(...items: ProviderUsage[]): ProviderUsage {
  return items.reduce<ProviderUsage>((total, item) => ({
    inputTokens: total.inputTokens + item.inputTokens,
    outputTokens: total.outputTokens + item.outputTokens,
  }), { ...EMPTY_USAGE });
}

function requiredText(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`Planner returned an invalid ${field}`);
  }
  return value.trim();
}

export function parseWorkflowPlan(text: string): PlanShape {
  const firstBrace = text.indexOf("{");
  const lastBrace = text.lastIndexOf("}");
  if (firstBrace < 0 || lastBrace <= firstBrace) {
    throw new Error("Planner did not return a JSON plan");
  }

  let value: unknown;
  try {
    value = JSON.parse(text.slice(firstBrace, lastBrace + 1));
  } catch {
    throw new Error("Planner returned malformed JSON");
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Planner returned an invalid plan");
  }
  const record = value as Record<string, unknown>;
  if (!Array.isArray(record.steps) || record.steps.length === 0 || record.steps.length > 12) {
    throw new Error("Planner must return between 1 and 12 steps");
  }

  return {
    summary: requiredText(record.summary, "summary"),
    steps: record.steps.map((item, index) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) {
        throw new Error(`Planner returned an invalid step ${index + 1}`);
      }
      const step = item as Record<string, unknown>;
      return {
        title: requiredText(step.title, `step ${index + 1} title`),
        instructions: requiredText(step.instructions, `step ${index + 1} instructions`),
        verification: requiredText(step.verification, `step ${index + 1} verification`),
      };
    }),
  };
}

export function formatWorkflowPlan(state: NativeWorkflowState): string {
  const steps = state.steps.map((step, index) => {
    return `${index + 1}. ${step.title} (${step.status})\n   ${step.instructions}\n   Verify: ${step.verification}`;
  });
  return `# Plan\n\n${state.summary}\n\n${steps.join("\n\n")}`;
}

export async function planWorkflow(
  options: WorkflowBaseOptions & { task: string },
): Promise<WorkflowResult> {
  const task = options.task.trim();
  if (!task) throw new Error("/plan requires a task");
  const activity: AgentEvent[] = [];
  const readOnlyTools = new WorkspaceTools(options.workspaceTools.root, "read-only");
  const result = await runAgent({
    prompt: `Create an implementation plan for this task:\n\n${task}`,
    catalog: options.catalog,
    provider: options.provider,
    workspaceTools: readOnlyTools,
    maxSubagents: 0,
    systemGuidance: nativeRoles["super-planner"].instructions,
    ...(options.signal ? { signal: options.signal } : {}),
    onEvent: (event) => {
      activity.push(event);
      options.onEvent?.(event);
    },
  });
  const plan = parseWorkflowPlan(result.text);
  const timestamp = (options.now ?? new Date()).toISOString();
  const state: NativeWorkflowState = {
    version: 1,
    task,
    summary: plan.summary,
    status: "planned",
    createdAt: timestamp,
    updatedAt: timestamp,
    steps: plan.steps.map((step, index) => ({
      id: `step-${index + 1}`,
      ...step,
      status: "pending",
      attempts: 0,
    })),
  };
  return { state, text: formatWorkflowPlan(state), activity, usage: result.usage };
}

interface CommandEvidence {
  passed: boolean;
  output: string;
}

function runVerifyCommand(command: string, cwd: string, signal?: AbortSignal): Promise<CommandEvidence> {
  return new Promise((resolve, reject) => {
    exec(command, {
      cwd,
      maxBuffer: 128 * 1024,
      timeout: 120_000,
      ...(signal ? { signal } : {}),
    }, (error, stdout, stderr) => {
      if (signal?.aborted) {
        reject(error ?? new Error("Verification stopped"));
        return;
      }
      const output = `${stdout}${stderr}`.trim();
      resolve({
        passed: !error,
        output: output || (error ? error.message : "Command completed successfully."),
      });
    });
  });
}

export async function runNextWorkflowStep(
  options: WorkflowBaseOptions & {
    state: NativeWorkflowState;
    verifyCommand?: string;
  },
): Promise<WorkflowResult> {
  const pendingIndex = options.state.steps.findIndex((step) => step.status === "pending");
  if (pendingIndex < 0) {
    const state = { ...options.state, status: "passed" as const };
    return { state, text: "PASS\nEvery planned step is verified.", activity: [], usage: { ...EMPTY_USAGE } };
  }

  const step = options.state.steps[pendingIndex];
  if (!step) throw new Error("Workflow step disappeared");
  const activity: AgentEvent[] = [];
  const forwardEvent = (event: AgentEvent): void => {
    activity.push(event);
    options.onEvent?.(event);
  };
  const context = `Task: ${options.state.task}\nPlan: ${options.state.summary}\n\nAssigned step: ${step.title}\n${step.instructions}\n\nVerification target: ${step.verification}`;
  const executed = await runAgent({
    prompt: context,
    catalog: options.catalog,
    provider: options.provider,
    workspaceTools: options.workspaceTools,
    maxSubagents: 0,
    systemGuidance: nativeRoles["super-executor"].instructions,
    ...(options.signal ? { signal: options.signal } : {}),
    onEvent: forwardEvent,
  });

  const commandEvidence = options.verifyCommand?.trim()
    ? await runVerifyCommand(options.verifyCommand, options.workspaceTools.root, options.signal)
    : undefined;
  const evidence = commandEvidence
    ? `Configured verification command ${commandEvidence.passed ? "passed" : "failed"}:\n${commandEvidence.output}`
    : "No verification command is configured. Inspect the workspace directly and use the available read-only tools.";
  const verified = await runAgent({
    prompt: `${context}\n\nExecutor report:\n${executed.text}\n\nExternal evidence:\n${evidence}`,
    catalog: options.catalog,
    provider: options.provider,
    workspaceTools: new WorkspaceTools(options.workspaceTools.root, "read-only"),
    maxSubagents: 0,
    systemGuidance: nativeRoles["super-verifier"].instructions,
    ...(options.signal ? { signal: options.signal } : {}),
    onEvent: forwardEvent,
  });
  const modelPassed = /^PASS(?:\r?\n|$)/.test(verified.text.trim());
  const passed = modelPassed && commandEvidence?.passed !== false;
  const nextSteps = options.state.steps.map((current, index) => index === pendingIndex
    ? { ...current, status: passed ? "passed" as const : "pending" as const, attempts: current.attempts + 1 }
    : current);
  const allPassed = nextSteps.every((current) => current.status === "passed");
  const state: NativeWorkflowState = {
    ...options.state,
    status: passed ? (allPassed ? "passed" : "planned") : "failed",
    updatedAt: (options.now ?? new Date()).toISOString(),
    steps: nextSteps,
    latestVerification: {
      stepId: step.id,
      passed,
      evidence: verified.text,
    },
  };
  return {
    state,
    text: `## Executed: ${step.title}\n\n${executed.text}\n\n## Verification\n\n${passed ? verified.text : verified.text.replace(/^PASS/, "FAIL")}`,
    activity,
    usage: usageSum(executed.usage, verified.usage),
  };
}

export async function runWorkflowLoop(
  options: WorkflowBaseOptions & {
    state: NativeWorkflowState;
    verifyCommand?: string;
    maxIterations?: number;
  },
): Promise<WorkflowResult> {
  const maximum = options.maxIterations ?? 6;
  if (!Number.isInteger(maximum) || maximum < 1 || maximum > 20) {
    throw new Error("Loop iterations must be an integer from 1 to 20");
  }
  let state = options.state;
  let usage = { ...EMPTY_USAGE };
  const activity: AgentEvent[] = [];
  const reports: string[] = [];

  for (let iteration = 0; iteration < maximum && state.status !== "passed"; iteration += 1) {
    const result = await runNextWorkflowStep({
      ...options,
      state,
      onEvent: (event) => {
        activity.push(event);
        options.onEvent?.(event);
      },
    });
    state = result.state;
    usage = usageSum(usage, result.usage);
    reports.push(result.text);
  }

  if (state.status !== "passed") {
    const stateWithFailure = { ...state, status: "failed" as const };
    return {
      state: stateWithFailure,
      text: `${reports.join("\n\n---\n\n")}\n\nLoop stopped before every step passed.`,
      activity,
      usage,
    };
  }
  return { state, text: reports.join("\n\n---\n\n"), activity, usage };
}
