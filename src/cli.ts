#!/usr/bin/env node
import { runAgent } from "./agent/run-agent.js";
import {
  createProvider,
  createSetupRequiredProvider,
  defaultModelFor,
  parseProviderName,
  providerEnvironmentKey,
  providerLabel,
  type ProviderName,
} from "./providers/create.js";
import { CredentialStore } from "./providers/credentials.js";
import { DemoProvider } from "./providers/mock.js";
import { fetchOpenRouterModels } from "./providers/openrouter-models.js";
import { SessionStore } from "./session/session-store.js";
import { resolveStartupSelection } from "./session/startup-selection.js";
import { discoverSkills } from "./skills/discovery.js";
import { defaultSkillScopes } from "./skills/scopes.js";
import { createWorkspaceTools, type WorkspaceMode } from "./tools/workspace.js";

declare const __MINI_AGENT_LITE__: boolean;

const liteBuild = typeof __MINI_AGENT_LITE__ !== "undefined" && __MINI_AGENT_LITE__;

interface Options {
  prompt: string;
  debug: boolean;
  json: boolean;
  mock: boolean;
  model: string;
  provider: ProviderName;
  selectionExplicit: boolean;
  maxSubagents: number;
  workspace: string;
  workspaceMode: WorkspaceMode;
  command?: "list" | "doctor";
}

function parseArguments(arguments_: string[]): Options {
  const prompt: string[] = [];
  let debug = false;
  let json = false;
  let mock = false;
  let model = process.env.MINI_AGENT_MODEL;
  let provider = parseProviderName(process.env.MINI_AGENT_PROVIDER ?? "anthropic");
  let selectionExplicit = Boolean(process.env.MINI_AGENT_MODEL || process.env.MINI_AGENT_PROVIDER);
  let maxSubagents = Number(process.env.MINI_AGENT_SUBAGENTS ?? 2);
  let workspace = process.env.MINI_AGENT_WORKSPACE ?? process.cwd();
  let workspaceMode: WorkspaceMode = process.env.MINI_AGENT_READ_ONLY === "1" ? "read-only" : "workspace-write";
  let command: Options["command"];

  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    if (argument === "--debug") debug = true;
    else if (argument === "--json") json = true;
    else if (argument === "--mock") mock = true;
    else if (argument === "--provider" || argument === "-p") {
      const value = arguments_[index + 1];
      if (!value) throw new Error("--provider requires a value");
      provider = parseProviderName(value);
      selectionExplicit = true;
      index += 1;
    }
    else if (argument === "--model" || argument === "-m") {
      const value = arguments_[index + 1];
      if (!value) throw new Error("--model requires a value");
      model = value;
      selectionExplicit = true;
      index += 1;
    } else if (argument === "--subagents") {
      const value = arguments_[index + 1];
      if (!value) throw new Error("--subagents requires a value");
      maxSubagents = Number(value);
      index += 1;
    } else if (argument === "--workspace") {
      const value = arguments_[index + 1];
      if (!value) throw new Error("--workspace requires a value");
      workspace = value;
      index += 1;
    } else if (argument === "--read-only") {
      workspaceMode = "read-only";
    } else if (argument === "skills") {
      const next = arguments_[index + 1];
      if (next !== "list" && next !== "doctor") throw new Error("skills requires list or doctor");
      command = next;
      index += 1;
    } else if (argument?.startsWith("-")) {
      throw new Error(`Unknown option: ${argument}`);
    } else if (argument) prompt.push(argument);
  }

  if (!Number.isInteger(maxSubagents) || maxSubagents < 0 || maxSubagents > 8) {
    throw new Error("--subagents must be an integer from 0 to 8");
  }

  return {
    prompt: prompt.join(" ").trim(),
    debug,
    json,
    mock,
    model: model ?? defaultModelFor(provider),
    provider,
    selectionExplicit,
    maxSubagents,
    workspace,
    workspaceMode,
    ...(command ? { command } : {}),
  };
}

function printHelp(): void {
  process.stdout.write(`mini-agent [options] "prompt"\n\nOptions:\n  -p, --provider <name>  anthropic, openrouter, or vercel\n  -m, --model <id>       any model ID supported by the provider\n      --workspace <path> project root for file tools (default: current directory)\n      --read-only        hide write and edit tools\n      --subagents <n>    delegation limit from 0 to 8 (default: 2)\n      --json             Print structured output\n      --debug            Print skill activations to stderr\n      --mock             Run the deterministic offline demo\n\nCommands:\n  skills list\n  skills doctor\n`);
}

async function main(): Promise<void> {
  const options = parseArguments(process.argv.slice(2));
  const catalog = await discoverSkills(defaultSkillScopes());

  if (options.command === "list") {
    for (const skill of catalog.skills) {
      process.stdout.write(`${skill.name}\t${skill.source}\t${skill.description}\n`);
    }
    return;
  }
  if (options.command === "doctor") {
    if (catalog.diagnostics.length === 0) {
      process.stdout.write(`OK: ${catalog.skills.length} valid skills\n`);
      return;
    }
    for (const diagnostic of catalog.diagnostics) {
      process.stdout.write(`${diagnostic.level.toUpperCase()} ${diagnostic.file}: ${diagnostic.message}\n`);
    }
    process.exitCode = catalog.diagnostics.some((diagnostic) => diagnostic.level === "error") ? 1 : 0;
    return;
  }
  const workspaceTools = await createWorkspaceTools(options.workspace, options.workspaceMode);
  const credentialStore = new CredentialStore();
  await Promise.all((["anthropic", "openrouter", "vercel"] as const).map(async (providerName) => {
    const environmentKey = providerEnvironmentKey(providerName);
    if (!process.env[environmentKey]) {
      const stored = await credentialStore.get(providerName);
      if (stored) process.env[environmentKey] = stored;
    }
  }));
  if (!options.prompt) {
    if (liteBuild || !process.stdin.isTTY || !process.stdout.isTTY) {
      printHelp();
      return;
    }

    const selection = options.mock
      ? { provider: options.provider, model: options.model }
      : await resolveStartupSelection(
          { provider: options.provider, model: options.model },
          new SessionStore(),
          !options.selectionExplicit,
        );
    const environmentKey = providerEnvironmentKey(selection.provider);
    const needsApiKey = !options.mock && !process.env[environmentKey];
    const provider = options.mock
      ? new DemoProvider()
      : needsApiKey
        ? createSetupRequiredProvider(selection.provider)
        : createProvider(selection.provider, selection.model);
    const { startInteractive } = await import("./ui/start.js");
    await startInteractive({
      catalog,
      provider,
      providerName: selection.provider,
      model: options.mock ? "offline demo" : selection.model,
      providerLabel: options.mock ? "Demo" : providerLabel(selection.provider),
      maxSubagents: options.maxSubagents,
      workspaceTools,
      persistSessions: !options.mock,
      needsApiKey,
      ...(!options.mock
        ? {
            createProvider: (providerName: ProviderName, model: string) =>
              createProvider(providerName, model),
            configureApiKey: async (providerName: ProviderName, model: string, apiKey: string) => {
              await credentialStore.set(providerName, apiKey);
              process.env[providerEnvironmentKey(providerName)] = apiKey;
              return createProvider(providerName, model);
            },
            loadModels: (signal: AbortSignal) => {
              const apiKey = process.env.OPENROUTER_API_KEY;
              if (!apiKey) throw new Error("OpenRouter needs an API key. Type /key to configure it.");
              return fetchOpenRouterModels(apiKey, globalThis.fetch, signal);
            },
          }
        : {}),
    });
    return;
  }

  const controller = new AbortController();
  const interrupt = (): void => controller.abort();
  process.once("SIGINT", interrupt);
  try {
    const result = await runAgent({
      prompt: options.prompt,
      catalog,
      provider: options.mock
        ? new DemoProvider()
        : createProvider(options.provider, options.model),
      signal: controller.signal,
      maxSubagents: options.maxSubagents,
      workspaceTools,
      ...(options.debug
        ? { onActivation: (name: string): void => { process.stderr.write(`activated ${name}\n`); } }
        : {}),
    });
    if (options.json) process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    else process.stdout.write(`${result.text}\n`);
  } finally {
    process.removeListener("SIGINT", interrupt);
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`mini-agent: ${message}\n`);
  process.exitCode = 1;
});
