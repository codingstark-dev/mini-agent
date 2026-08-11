import { existsSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type { SkillScope } from "./discovery.js";

function packageRoot(): string {
  let candidate = path.dirname(fileURLToPath(import.meta.url));
  while (path.dirname(candidate) !== candidate) {
    if (existsSync(path.join(candidate, "package.json"))) return candidate;
    candidate = path.dirname(candidate);
  }
  return process.cwd();
}

export function defaultSkillScopes(cwd = process.cwd(), home = homedir()): SkillScope[] {
  const ordered: SkillScope[] = [
    { directory: path.join(packageRoot(), ".skills"), source: "bundled" },
    { directory: path.join(home, ".agents", "skills"), source: "user" },
    { directory: path.join(cwd, ".agents", "skills"), source: "project" },
    { directory: path.join(cwd, ".skills"), source: "project" },
  ];
  const unique = new Map<string, SkillScope>();
  for (const scope of ordered) {
    const directory = path.resolve(scope.directory);
    unique.delete(directory);
    unique.set(directory, { ...scope, directory });
  }
  return [...unique.values()];
}
