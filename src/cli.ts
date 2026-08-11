#!/usr/bin/env node
import { runAgent } from "./agent/run-agent.js";
import {
  createProvider,
  defaultModelFor,
  parseProviderName,
  providerLabel,
  type ProviderName,
} from "./providers/create.js";
import { DemoProvider } from "./providers/mock.js";
import { discoverSkills } from "./skills/discovery.js";
import { defaultSkillScopes } from "./skills/scopes.js";

declare const __MINI_AGENT_LITE__: boolean;

const liteBuild = typeof __MINI_AGENT_LITE__ !== "undefined" && __MINI_AGENT_LITE__;

interface Options {
  prompt: string;
  debug: boolean;
  json: boolean;
  mock: boolean;
  model: string;
  provider: ProviderName;
  command?: "list" | "doctor";
}

function parseArguments(arguments_: string[]): Options {
  const prompt: string[] = [];
  let debug = false;
  let json = false;
  let mock = false;
  let model = process.env.MINI_AGENT_MODEL;
  let provider = parseProviderName(process.env.MINI_AGENT_PROVIDER ?? "anthropic");
  let command: Options["command"];

  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    if (argument === "--debug") debug = true;
    else if (argument === "--json") json = true;
    else if (argument === "--mock") mock = true;
    else if (argument === "--provider") {
      const value = arguments_[index + 1];
      if (!value) throw new Error("--provider requires a value");
      provider = parseProviderName(value);
      index += 1;
    }
    else if (argument === "--model") {
      const value = arguments_[index + 1];
      if (!value) throw new Error("--model requires a value");
      model = value;
      index += 1;
    } else if (argument === "skills") {
      const next = arguments_[index + 1];
      if (next !== "list" && next !== "doctor") throw new Error("skills requires list or doctor");
      command = next;
      index += 1;
    } else if (argument?.startsWith("-")) {
      throw new Error(`Unknown option: ${argument}`);
    } else if (argument) prompt.push(argument);
  }

  return {
    prompt: prompt.join(" ").trim(),
    debug,
    json,
    mock,
    model: model ?? defaultModelFor(provider),
    provider,
    ...(command ? { command } : {}),
  };
}

function printHelp(): void {
  process.stdout.write(`mini-agent [options] "prompt"\n\nOptions:\n  --provider <name>  anthropic, openrouter, or vercel\n  --model <id>       Override the provider's default model\n  --json             Print structured output\n  --debug            Print skill activations to stderr\n  --mock             Run the deterministic offline demo\n\nCommands:\n  skills list\n  skills doctor\n`);
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
  if (!options.prompt) {
    if (liteBuild || !process.stdin.isTTY || !process.stdout.isTTY) {
      printHelp();
      return;
    }

    const provider = options.mock
      ? new DemoProvider()
      : createProvider(options.provider, options.model);
    const { startInteractive } = await import("./ui/start.js");
    await startInteractive({
      catalog,
      provider,
      model: options.mock
        ? "offline demo"
        : `${providerLabel(options.provider)} · ${options.model}`,
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
