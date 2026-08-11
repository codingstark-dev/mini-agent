import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { discoverSkills } from "../../src/skills/discovery.js";

test("discovers skill metadata without exposing instructions", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "mini-agent-skills-"));
  const skillDirectory = path.join(root, "welcome-me");
  await mkdir(skillDirectory);
  await writeFile(
    path.join(skillDirectory, "SKILL.md"),
    `---\nname: welcome-me\ndescription: Welcome people who are new to a project.\n---\n\nSECRET INSTRUCTION BODY`,
  );

  const catalog = await discoverSkills([{ directory: root, source: "project" }]);

  assert.deepEqual(catalog.skills.map(({ name, description, source }) => ({ name, description, source })), [
    {
      name: "welcome-me",
      description: "Welcome people who are new to a project.",
      source: "project",
    },
  ]);
  assert.equal(JSON.stringify(catalog.skills).includes("SECRET INSTRUCTION BODY"), false);
  assert.deepEqual(catalog.diagnostics, []);
});

test("project skills override bundled skills with a visible diagnostic", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "mini-agent-precedence-"));
  const bundled = path.join(root, "bundled", "release-notes");
  const project = path.join(root, "project", "release-notes");
  await mkdir(bundled, { recursive: true });
  await mkdir(project, { recursive: true });
  await writeFile(
    path.join(bundled, "SKILL.md"),
    `---\nname: release-notes\ndescription: Bundled guidance.\n---\n\nBundled body`,
  );
  await writeFile(
    path.join(project, "SKILL.md"),
    `---\nname: release-notes\ndescription: Project guidance.\n---\n\nProject body`,
  );

  const catalog = await discoverSkills([
    { directory: path.join(root, "bundled"), source: "bundled" },
    { directory: path.join(root, "project"), source: "project" },
  ]);

  assert.equal(catalog.skills[0]?.description, "Project guidance.");
  assert.match(catalog.diagnostics[0]?.message ?? "", /overrides/);
});

test("rejects metadata that does not satisfy the skill specification", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "mini-agent-invalid-"));
  const invalid = path.join(root, "wrong-directory");
  await mkdir(invalid);
  await writeFile(
    path.join(invalid, "SKILL.md"),
    `---\nname: Bad--Name\ndescription: Invalid metadata.\n---\n\nBody`,
  );

  const catalog = await discoverSkills([{ directory: root, source: "project" }]);

  assert.equal(catalog.skills.length, 0);
  assert.match(catalog.diagnostics[0]?.message ?? "", /lowercase letters, numbers, and single hyphens/);
});
