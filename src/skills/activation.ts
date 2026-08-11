import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

import type { SkillSummary } from "./discovery.js";

export interface ActivatedSkill {
  name: string;
  directory: string;
  instructions: string;
  resources: string[];
}

function instructionBody(markdown: string): string {
  const match = /^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)([\s\S]*)$/.exec(markdown);
  if (!match) throw new Error("SKILL.md must start with YAML frontmatter");
  return (match[1] ?? "").trim();
}

async function listResources(directory: string): Promise<string[]> {
  const resources: string[] = [];
  const entries = await readdir(directory, { withFileTypes: true });

  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (entry.name === "SKILL.md" || entry.name.startsWith(".")) continue;
    if (entry.isFile()) {
      resources.push(entry.name);
      continue;
    }
    if (!entry.isDirectory()) continue;

    const children = await readdir(path.join(directory, entry.name), { withFileTypes: true });
    for (const child of children.sort((a, b) => a.name.localeCompare(b.name))) {
      if (child.isFile() && !child.name.startsWith(".")) {
        resources.push(path.posix.join(entry.name, child.name));
      }
    }
  }

  return resources;
}

export async function activateSkill(skill: SkillSummary): Promise<ActivatedSkill> {
  const directory = path.dirname(skill.file);
  const markdown = await readFile(skill.file, "utf8");

  return {
    name: skill.name,
    directory,
    instructions: instructionBody(markdown),
    resources: await listResources(directory),
  };
}
