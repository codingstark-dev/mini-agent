import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";

import { createWorkspaceTools } from "../../src/tools/workspace.js";

const execFileAsync = promisify(execFile);

test("workspace tools create, edit, read, and search project files", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "mini-agent-tools-"));
  const tools = await createWorkspaceTools(root, "workspace-write");

  await tools.execute("write_file", {
    path: "site/index.html",
    content: "<h1>Hello</h1>\n<p>First draft</p>\n",
  });
  await tools.execute("edit_file", {
    path: "site/index.html",
    old_text: "First draft",
    new_text: "Ready to ship",
  });

  const read = await tools.execute("read_file", { path: "site/index.html" });
  const search = await tools.execute("search_files", { pattern: "Ready to ship", path: "site" });

  assert.match(read.content, /<h1>Hello<\/h1>/);
  assert.match(search.content, /site\/index\.html:2/);
  assert.match(await readFile(path.join(root, "site/index.html"), "utf8"), /Ready to ship/);
});

test("workspace tools reject traversal and symlink escapes", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "mini-agent-root-"));
  const outside = await mkdtemp(path.join(tmpdir(), "mini-agent-outside-"));
  await writeFile(path.join(outside, "secret.txt"), "outside");
  await symlink(outside, path.join(root, "escape"));
  const tools = await createWorkspaceTools(root, "workspace-write");

  await assert.rejects(tools.execute("read_file", { path: "../secret.txt" }), /outside the workspace/);
  await assert.rejects(tools.execute("read_file", { path: "escape/secret.txt" }), /outside the workspace/);
});

test("read-only mode exposes no mutating tools", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "mini-agent-read-only-"));
  await mkdir(path.join(root, "src"));
  const tools = await createWorkspaceTools(root, "read-only");

  assert.equal(tools.tools.some((tool) => tool.name === "write_file"), false);
  await assert.rejects(
    tools.execute("write_file", { path: "src/new.ts", content: "export {};" }),
    /not available/,
  );
});

test("git history is available to read-only skills such as changelog-generator", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "mini-agent-git-history-"));
  await execFileAsync("git", ["init", "--quiet"], { cwd: root });
  await writeFile(path.join(root, "README.md"), "# Demo\n");
  await execFileAsync("git", ["add", "README.md"], { cwd: root });
  await execFileAsync("git", [
    "-c", "user.name=Test User",
    "-c", "user.email=test@example.com",
    "commit", "--quiet", "-m", "feat: add welcome page",
  ], { cwd: root });
  const tools = await createWorkspaceTools(root, "read-only");

  const history = await tools.execute("git_history", { max_count: 5 });

  assert.equal(tools.tools.some((tool) => tool.name === "git_history"), true);
  assert.match(history.content, /feat: add welcome page/);
});
