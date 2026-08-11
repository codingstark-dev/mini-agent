import { superExecutor } from "./super-executor.js";
import { superExplorer } from "./super-explorer.js";
import { superOracle } from "./super-oracle.js";
import { superPlanner } from "./super-planner.js";
import { superVerifier } from "./super-verifier.js";

export const nativeRoles = {
  "super-planner": superPlanner,
  "super-executor": superExecutor,
  "super-verifier": superVerifier,
  "super-explorer": superExplorer,
  "super-oracle": superOracle,
} as const;

export type { NativeRole, NativeRoleName } from "./types.js";
