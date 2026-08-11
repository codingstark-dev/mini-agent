import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { activateSkill } from "../../src/skills/activation.js";
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
