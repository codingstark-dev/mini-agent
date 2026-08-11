import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
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

test("the offline demo creates an HTML page through the workspace tool", async () => {
  const workspace = await mkdtemp(path.join(tmpdir(), "mini-agent-demo-page-"));
  const { stdout, stderr } = await execFileAsync(
    process.execPath,
    ["--import", "tsx", "src/cli.ts", "--mock", "--workspace", workspace, "Create an HTML page"],
    { cwd: process.cwd() },
  );

  assert.equal(stderr, "");
  assert.match(stdout, /Created index\.html/);
  assert.match(await readFile(path.join(workspace, "index.html"), "utf8"), /<h1>Mini agent<\/h1>/);
});
