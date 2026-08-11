import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

import { parse } from "yaml";

export type SkillSource = "bundled" | "user" | "project";

export interface SkillScope {
  directory: string;
  source: SkillSource;
}

export interface SkillSummary {
  name: string;
  description: string;
  file: string;
  source: SkillSource;
}

export interface SkillDiagnostic {
  level: "warning" | "error";
  file: string;
  message: string;
}

export interface SkillCatalog {
  skills: SkillSummary[];
  diagnostics: SkillDiagnostic[];
}

function frontmatter(markdown: string): unknown {
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(markdown);
  if (!match?.[1]) {
    throw new Error("SKILL.md must start with YAML frontmatter");
  }

  return parse(match[1]);
}

export async function discoverSkills(scopes: readonly SkillScope[]): Promise<SkillCatalog> {
  const skills = new Map<string, SkillSummary>();
  const diagnostics: SkillDiagnostic[] = [];

  for (const scope of scopes) {
    let entries;
    try {
      entries = await readdir(scope.directory, { withFileTypes: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
      throw error;
    }

    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (!entry.isDirectory()) continue;

      const file = path.resolve(scope.directory, entry.name, "SKILL.md");
      try {
        const metadata = frontmatter(await readFile(file, "utf8"));
        if (!metadata || typeof metadata !== "object") {
          throw new Error("frontmatter must be a YAML mapping");
        }

        const { name, description } = metadata as Record<string, unknown>;
        if (typeof name !== "string" || name.length === 0) {
          throw new Error("frontmatter requires a non-empty name");
        }
        if (typeof description !== "string" || description.length === 0) {
          throw new Error("frontmatter requires a non-empty description");
        }

        skills.set(name, { name, description, file, source: scope.source });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
        diagnostics.push({
          level: "error",
          file,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  return { skills: [...skills.values()], diagnostics };
}
