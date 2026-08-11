import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import test from "node:test";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

test("the documented mock command demonstrates welcome skill selection", async () => {
  const { stdout, stderr } = await execFileAsync(
    process.execPath,
    ["--import", "tsx", "src/cli.ts", "--mock", "--debug", "I'm new to this project, what should I do?"],
    { cwd: process.cwd() },
  );

  assert.match(stdout, /^> Welcome to our Command Code assignment agent!/);
  assert.match(stderr, /activated welcome-me/);
});
