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

function requiredText(metadata: Record<string, unknown>, field: string): string {
  const value = metadata[field];
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`frontmatter requires a non-empty ${field}`);
  }
  return value.trim();
}

function validateMetadata(metadata: Record<string, unknown>, directoryName: string): {
  name: string;
  description: string;
} {
  const name = requiredText(metadata, "name");
  const description = requiredText(metadata, "description");

  if (name.length > 64) throw new Error("name must contain at most 64 characters");
  if (!/^(?!.*--)[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name)) {
    throw new Error("name may contain only lowercase letters, numbers, and single hyphens");
  }
  if (name !== directoryName) throw new Error(`name must match its directory (${directoryName})`);
  if (description.length > 1024) throw new Error("description must contain at most 1024 characters");

  const compatibility = metadata.compatibility;
  if (compatibility !== undefined) {
    if (typeof compatibility !== "string" || compatibility.length === 0 || compatibility.length > 500) {
      throw new Error("compatibility must be a non-empty string of at most 500 characters");
    }
  }

  const arbitraryMetadata = metadata.metadata;
  if (arbitraryMetadata !== undefined) {
    if (!arbitraryMetadata || typeof arbitraryMetadata !== "object" || Array.isArray(arbitraryMetadata)) {
      throw new Error("metadata must be a mapping of string keys to string values");
    }
    if (Object.values(arbitraryMetadata).some((value) => typeof value !== "string")) {
      throw new Error("metadata values must be strings");
    }
  }

  for (const field of ["license", "allowed-tools"] as const) {
    if (metadata[field] !== undefined && typeof metadata[field] !== "string") {
      throw new Error(`${field} must be a string`);
    }
  }

  return { name, description };
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

        const { name, description } = validateMetadata(
          metadata as Record<string, unknown>,
          entry.name,
        );

        const shadowed = skills.get(name);
        if (shadowed) {
          diagnostics.push({
            level: "warning",
            file,
            message: `${scope.source} skill ${name} overrides ${shadowed.source} skill at ${shadowed.file}`,
          });
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
