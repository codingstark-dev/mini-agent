import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { resolve } from "node:path";
import test from "node:test";

interface CliResult {
  code: number | null;
  stderr: string;
}

function runCli(arguments_: string[], environment: NodeJS.ProcessEnv): Promise<CliResult> {
  return new Promise((resolveResult, reject) => {
    const child = spawn(process.execPath, ["--import", "tsx", resolve("src/cli.ts"), ...arguments_], {
      env: environment,
      stdio: ["ignore", "ignore", "pipe"],
    });
    let stderr = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => { stderr += chunk; });
    child.once("error", reject);
    child.once("close", (code) => { resolveResult({ code, stderr }); });
  });
}

test("OpenRouter selection asks for its own API key", async () => {
  const result = await runCli(["--provider", "openrouter", "hello"], {
    ...process.env,
    OPENROUTER_API_KEY: "",
  });

  assert.equal(result.code, 1);
  assert.match(result.stderr, /OPENROUTER_API_KEY/);
});

test("Vercel AI Gateway selection asks for its own API key", async () => {
  const result = await runCli(["--provider", "vercel", "hello"], {
    ...process.env,
    AI_GATEWAY_API_KEY: "",
  });

  assert.equal(result.code, 1);
  assert.match(result.stderr, /AI_GATEWAY_API_KEY/);
});
