import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { symlink } from "node:fs/promises";

import { activateSkill, readSkillResource } from "../../src/skills/activation.js";
import { discoverSkills } from "../../src/skills/discovery.js";

test("activation loads instructions and advertises resources on demand", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "mini-agent-activation-"));
  const skillDirectory = path.join(root, "internal-comms");
  await mkdir(path.join(skillDirectory, "references"), { recursive: true });
  await writeFile(
    path.join(skillDirectory, "SKILL.md"),
    `---\nname: internal-comms\ndescription: Write internal updates.\n---\n\n# Instructions\nRead references/status.md when needed.`,
  );
  await writeFile(path.join(skillDirectory, "references", "status.md"), "Use Progress, Plans, Problems.");

  const catalog = await discoverSkills([{ directory: root, source: "project" }]);
  const skill = catalog.skills[0];
  assert.ok(skill);

  const activated = await activateSkill(skill);

  assert.equal(activated.name, "internal-comms");
  assert.match(activated.instructions, /^# Instructions/);
  assert.equal(activated.instructions.includes("description:"), false);
  assert.deepEqual(activated.resources, ["references/status.md"]);
});

test("the bundled welcome skill preserves the assignment's required header", async () => {
  const catalog = await discoverSkills([
    { directory: path.resolve(".skills"), source: "bundled" },
  ]);
  const welcome = catalog.skills.find((skill) => skill.name === "welcome-me");
  assert.ok(welcome);

  const activated = await activateSkill(welcome);

  assert.match(activated.instructions, /> Welcome to our agent!/);
  assert.deepEqual(
    catalog.skills.map((skill) => skill.name).sort(),
    ["changelog-generator", "internal-comms", "welcome-me"],
  );
});

test("resource reads stay inside the active skill", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "mini-agent-resource-"));
  const skillDirectory = path.join(root, "internal-comms");
  await mkdir(path.join(skillDirectory, "examples"), { recursive: true });
  await writeFile(
    path.join(skillDirectory, "SKILL.md"),
    `---\nname: internal-comms\ndescription: Write internal updates.\n---\n\nRead the matching example.`,
  );
  await writeFile(path.join(skillDirectory, "examples", "status.md"), "Use a 3P update.");
  const outside = path.join(root, "secret.txt");
  await writeFile(outside, "not for the model");
  await symlink(outside, path.join(skillDirectory, "examples", "escape.md"));
  const catalog = await discoverSkills([{ directory: root, source: "project" }]);
  const skill = catalog.skills[0];
  assert.ok(skill);
  const activated = await activateSkill(skill);

  assert.equal(await readSkillResource(activated, "examples/status.md"), "Use a 3P update.");
  await assert.rejects(readSkillResource(activated, "../secret.txt"), /inside the active skill/);
  await assert.rejects(readSkillResource(activated, "examples/escape.md"), /inside the active skill/);
});
