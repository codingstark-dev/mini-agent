import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path, { resolve } from "node:path";
import test from "node:test";

interface CliResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

function runCli(arguments_: string[], environment: NodeJS.ProcessEnv): Promise<CliResult> {
  return new Promise((resolveResult, reject) => {
    const child = spawn(process.execPath, ["--import", "tsx", resolve("src/cli.ts"), ...arguments_], {
      env: environment,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => { stdout += chunk; });
    child.stderr.on("data", (chunk: string) => { stderr += chunk; });
    child.once("error", reject);
    child.once("close", (code) => { resolveResult({ code, stdout, stderr }); });
  });
}

test("OpenRouter selection asks for its own API key", async () => {
  const stateDirectory = await mkdtemp(path.join(tmpdir(), "mini-agent-cli-"));
  const result = await runCli(["--provider", "openrouter", "hello"], {
    ...process.env,
    MINI_AGENT_STATE_DIR: stateDirectory,
    OPENROUTER_API_KEY: "",
  });

  assert.equal(result.code, 1);
  assert.match(result.stderr, /OPENROUTER_API_KEY/);
});

test("Vercel AI Gateway selection asks for its own API key", async () => {
  const stateDirectory = await mkdtemp(path.join(tmpdir(), "mini-agent-cli-"));
  const result = await runCli(["--provider", "vercel", "hello"], {
    ...process.env,
    MINI_AGENT_STATE_DIR: stateDirectory,
    AI_GATEWAY_API_KEY: "",
  });

  assert.equal(result.code, 1);
  assert.match(result.stderr, /AI_GATEWAY_API_KEY/);
});

test("short options select an OpenRouter model", async () => {
  const result = await runCli(
    ["-p", "openrouter", "-m", "deepseek/deepseek-v4-flash", "--mock", "hello"],
    process.env,
  );

  assert.equal(result.code, 0);
  assert.equal(result.stderr, "");
  assert.match(result.stdout, /demo provider/i);
});

test("the subagent budget can be configured from the CLI", async () => {
  const result = await runCli(["--subagents", "0", "--mock", "hello"], process.env);

  assert.equal(result.code, 0);
  assert.equal(result.stderr, "");
});
