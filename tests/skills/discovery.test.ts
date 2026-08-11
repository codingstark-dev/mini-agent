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
